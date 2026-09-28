// App orchestrator: mode state machine, fixed-timestep loop, event routing to world /
// audio / HUD, camera framing, saving and quality management.

import * as THREE from 'three';
import {
  AUTOSAVE_INTERVAL,
  BLADE,
  CARRY,
  MAX_FRAME_DT,
  MAX_SIM_STEPS_PER_FRAME,
  REACH,
  REPLANT,
  SIM_STEP,
  TIERS,
  TRUCK,
  VACUUM,
  XP,
  JUICE,
} from '../config/balance';
import { CAMERA, FIELD, HOSE_ANCHOR, PADS, PALLETS, TRUCK_LAYOUT, WORKSHOP } from '../config/worldLayout';
import { createInitialState, type GameState, type SettingsState, type ToolId } from './GameState';
import { Simulation, type SimMode } from './Simulation';
import type { GameEvent } from './Events';
import { clearSave, loadGame, loadSettings, saveGame, type LoadResult } from './SaveSystem';
import { FarmWorld, type QualityProfile, type ViewMode } from '../world/FarmWorld';
import { CameraRig, type Framing } from '../world/CameraRig';
import { InputManager } from '../input/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { HUD, type HudMode } from '../ui/HUD';
import { UpgradePanel } from '../ui/UpgradePanel';
import { SettingsPanel } from '../ui/SettingsPanel';
import { ICONS } from '../ui/icons';
import { formatMoney } from '../gameplay/Economy';
import { leftoverUnits } from '../gameplay/Inventory';
import { updateTutorial, type TutorialView } from '../gameplay/Tutorial';
import { currentGoal, goalText, updateGoals } from '../gameplay/Goals';
import { describeUpgrade, type UpgradeKey } from '../gameplay/UpgradeSystem';
import { reachableDepletion, tierForRow } from '../world/FieldModel';
import { clamp01 } from '../effects/Tweens';
import { DEPOT_VISUAL_CAP } from '../world/BaleRenderer';

export type AppMode =
  | 'BOOT'
  | 'TITLE'
  | 'FARM'
  | 'TRANSITION_TO_HARVEST'
  | 'HARVEST'
  | 'TRANSITION_TO_FARM'
  | 'UPGRADE_PANEL'
  | 'PAUSED';

const QUALITY: Record<'low' | 'medium' | 'high', QualityProfile> = {
  low: { grass: 'low', shadows: false, shadowSize: 512, debris: 250, pixelRatio: 1 },
  medium: { grass: 'normal', shadows: true, shadowSize: 1024, debris: 380, pixelRatio: 1.5 },
  high: { grass: 'rich', shadows: true, shadowSize: 2048, debris: 500, pixelRatio: 2 },
};

interface PrevPos {
  tx: number;
  tz: number;
  px: number;
  pz: number;
  hx: number;
  hz: number;
}

export class Game {
  readonly frame: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly cameraRig: CameraRig;
  readonly sim: Simulation;
  world: FarmWorld;
  readonly input: InputManager;
  readonly audio: AudioManager;
  readonly hud: HUD;
  readonly upgrades: UpgradePanel;
  readonly settingsPanel: SettingsPanel;
  mode: AppMode = 'BOOT';
  private resumeMode: 'FARM' | 'HARVEST' = 'FARM';
  private transT = 0;
  private acc = 0;
  private last = 0;
  private time = 0;
  private prev: PrevPos = { tx: 0, tz: 0, px: 0, pz: 0, hx: 0, hz: 0 };
  private autosaveT = 0;
  private saveSoon = -1;
  private qualityLevel: 'low' | 'medium' | 'high' = 'medium';
  private fpsWindow: number[] = [];
  private autoCheckT = 0;
  private cashTicks = 0;
  private cashTickT = 0;
  private depletionT = 0;
  private depletion = 0;
  private reachHintT = -1;
  private titleEl: HTMLDivElement;
  private loadResult: LoadResult;
  private camTarget = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private moveWorld = { x: 0, z: 0 };
  private tutorialView: TutorialView | null = null;
  private debug: { update(dt: number): void } | null = null;
  private lastPickupPitch = 0;
  private frameW = 390;
  private frameH = 844;
  fps = 60;
  frameMs = 16;

  constructor(frame: HTMLElement, canvas: HTMLCanvasElement) {
    this.frame = frame;
    this.canvas = canvas;
    const settings = loadSettings();
    this.loadResult = loadGame();
    const state = this.loadResult.kind === 'ok' ? this.loadResult.state : createInitialState(1337, settings);
    if (this.loadResult.kind === 'ok') state.settings = { ...state.settings, ...settings };

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.qualityLevel = this.pickQuality(state.settings);
    const q = QUALITY[this.qualityLevel];
    this.cameraRig = new CameraRig();
    this.sim = new Simulation(state);
    this.world = new FarmWorld(state, q);
    this.applyPixelRatio();

    this.audio = new AudioManager(this.audioSettings(state.settings));
    this.audio.onStateChange = (s) => {
      const need = s !== 'running' && this.mode !== 'TITLE' && this.mode !== 'BOOT';
      this.hud.setAudioButton(need && !state.settings.muted);
      this.settingsPanel.setAudioNeeded(s !== 'running');
    };

    const overlay = document.createElement('div');
    overlay.className = 'layer';
    frame.appendChild(overlay);
    this.input = new InputManager(canvas, overlay, {
      tool1: () => this.selectTool('BLADE'),
      tool2: () => this.selectTool('VACUUM'),
      toggleTool: () => this.selectTool(this.sim.state.harvester.tool === 'BLADE' ? 'VACUUM' : 'BLADE'),
      interact: () => this.interact(),
      escape: () => this.escape(),
      desktopDetected: () => this.hud.setDesktop(true),
      firstGesture: () => void this.unlockAudio(),
    });

    const hudRoot = document.createElement('div');
    hudRoot.className = 'layer';
    frame.appendChild(hudRoot);
    this.hud = new HUD(hudRoot, {
      onTool: (t) => this.selectTool(t),
      onBack: () => this.goFarm(),
      onSettings: () => this.openSettings(),
      onReplant: () => this.replant(),
      onPackLeftovers: () => this.packLeftovers(),
      onEnableAudio: () => void this.unlockAudio(),
      uiSound: (k) => this.audio.play(k === 'click' ? 'uiClick' : 'uiDisabled'),
    });

    this.upgrades = new UpgradePanel(hudRoot);
    this.upgrades.onBuy = (k) => this.buy(k);
    this.upgrades.onClose = () => this.closeUpgrades();
    this.upgrades.uiSound = (k) => this.audio.play(k === 'click' ? 'uiClick' : 'uiDisabled');

    this.settingsPanel = new SettingsPanel(hudRoot, state.settings, {
      onChange: (s) => this.applySettings(s),
      onResume: () => this.closeSettings(),
      onReset: () => this.resetSave(),
      onEnableAudio: () => void this.unlockAudio(),
      uiSound: (k) => this.audio.play(k === 'click' ? 'uiClick' : 'uiDisabled'),
    });
    this.settingsPanel.setInfo(
      'Controls: drag anywhere to move (or WASD / arrows). 1 = Cut, 2 = Vacuum, Space = swap, E = harvest / back to farm, Esc = pause.<br>Progress saves automatically on this device.',
    );

    this.titleEl = this.buildTitle();
    frame.appendChild(this.titleEl);

    this.applySettings(state.settings, false);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(frame);
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      const hidden = document.hidden;
      this.audio.setHidden(hidden);
      if (hidden) this.save();
      this.last = performance.now();
    });
    window.addEventListener('pagehide', () => this.save());

    this.recordPrev();
    this.cameraRig.snap(this.titleFraming());
    this.setMode('TITLE');

    if (new URLSearchParams(location.search).get('debug') === '1') {
      void import('../debug/DebugPanel').then((m) => {
        this.debug = new m.DebugPanel(this, hudRoot);
      });
    }
  }

  get state(): GameState {
    return this.sim.state;
  }

  // ---- Setup helpers ------------------------------------------------------------------

  private pickQuality(s: SettingsState): 'low' | 'medium' | 'high' {
    if (s.quality !== 'auto') return s.quality;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency ?? 4;
    if (coarse) return cores >= 6 ? 'medium' : 'low';
    return 'high';
  }

  private applyPixelRatio(): void {
    const q = QUALITY[this.qualityLevel];
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, q.pixelRatio));
  }

  private audioSettings(s: SettingsState) {
    return { master: s.master, sfx: s.sfx, ambience: s.ambience, music: s.music, muted: s.muted };
  }

  private resize(): void {
    const r = this.frame.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.frameW && h === this.frameH && this.renderer.domElement.width > 0) {
      // Still recalibrate joystick radius in case of zoom.
    }
    this.frameW = w;
    this.frameH = h;
    this.renderer.setSize(w, h, false);
    this.cameraRig.resize(w, h);
    this.hud?.setViewport(w);
    this.input.joystick.calibrate();
    this.input.reset();
  }

  private buildTitle(): HTMLDivElement {
    const t = document.createElement('div');
    t.className = 'title';
    const hasSave = this.loadResult.kind === 'ok';
    const corrupt = this.loadResult.kind === 'corrupt';
    t.innerHTML = `
      <div class="logo"><h1>Meadow<br/>Haul</h1><p>Cut · Vacuum · Haul · Grow</p></div>
      <button class="btn warm ui" data-act="play">${hasSave ? 'Continue' : 'Play'}</button>
      ${hasSave ? '<button class="btn small ui" data-act="new">New farm</button>' : ''}
      ${corrupt ? '<div class="note">Your saved farm could not be loaded (data looked damaged).<br/>Starting fresh will replace it.</div>' : ''}
      <div class="note">Best in portrait · drag to move · sound on</div>`;
    t.addEventListener('pointerdown', (e) => e.stopPropagation());
    const play = t.querySelector('[data-act="play"]') as HTMLButtonElement;
    play.addEventListener('click', () => {
      void this.unlockAudio();
      this.audio.play('uiClick');
      if (corrupt) this.startNewGame(false);
      this.startPlaying();
    });
    const nw = t.querySelector('[data-act="new"]') as HTMLButtonElement | null;
    nw?.addEventListener('click', () => {
      void this.unlockAudio();
      this.audio.play('uiClick');
      nw.textContent = 'Tap again to erase save';
      nw.classList.add('danger');
      nw.onclick = () => {
        this.startNewGame(true);
        this.startPlaying();
      };
    });
    return t;
  }

  private startNewGame(wipe: boolean): void {
    if (wipe) clearSave();
    const s = createInitialState(Math.floor(Math.random() * 1e9), { ...this.state.settings });
    this.sim.setState(s);
    this.world.setState(s);
    this.recordPrev();
  }

  private startPlaying(): void {
    this.titleEl.classList.add('out');
    setTimeout(() => this.titleEl.classList.add('hidden'), 350);
    this.setMode('FARM');
    this.cameraRig.transitionTo(this.farmFraming(), 0.9);
    this.save();
  }

  private async unlockAudio(): Promise<void> {
    const ok = await this.audio.unlock();
    this.hud.setAudioButton(!ok && this.mode !== 'TITLE' && !this.state.settings.muted);
    this.settingsPanel.setAudioNeeded(!ok);
  }

  // ---- Modes ----------------------------------------------------------------------------

  private setMode(m: AppMode): void {
    this.mode = m;
    let simMode: SimMode = 'IDLE';
    let hud: HudMode = 'TITLE';
    switch (m) {
      case 'FARM':
        simMode = 'FARM';
        hud = 'FARM';
        break;
      case 'HARVEST':
        simMode = 'HARVEST';
        hud = 'HARVEST';
        break;
      case 'TRANSITION_TO_FARM':
      case 'TRANSITION_TO_HARVEST':
        simMode = 'TRANSITION';
        hud = 'TRANSITION';
        break;
      case 'UPGRADE_PANEL':
        simMode = 'TRANSITION';
        hud = 'PANEL';
        break;
      case 'PAUSED':
        simMode = 'TRANSITION';
        hud = 'MODAL';
        break;
      default:
        simMode = 'IDLE';
        hud = 'TITLE';
    }
    this.sim.setMode(simMode);
    this.hud.setMode(hud);
    // Movement input only reaches the world in FARM/HARVEST.
    this.input.enabled = m === 'FARM' || m === 'HARVEST';
    this.audio.setPaused(m === 'PAUSED' || m === 'UPGRADE_PANEL');
    this.world.setWorkshopLight(m === 'UPGRADE_PANEL');
  }

  private get simulating(): boolean {
    return this.mode === 'FARM' || this.mode === 'HARVEST' || this.mode === 'TRANSITION_TO_FARM' || this.mode === 'TRANSITION_TO_HARVEST';
  }

  goHarvest(): void {
    if (this.mode !== 'FARM') return;
    this.setMode('TRANSITION_TO_HARVEST');
    this.transT = 0;
    this.cameraRig.transitionTo(this.harvestFraming());
    this.audio.play('transition');
    this.requestSave();
  }

  goFarm(): void {
    if (this.mode !== 'HARVEST') return;
    this.setMode('TRANSITION_TO_FARM');
    this.transT = 0;
    this.cameraRig.transitionTo(this.farmFraming());
    this.audio.play('transition');
    this.requestSave();
  }

  private interact(): void {
    if (this.mode === 'HARVEST') {
      this.goFarm();
      return;
    }
    if (this.mode === 'FARM') {
      const p = this.state.player;
      const d = Math.hypot(p.x - PADS.harvest.x, p.z - PADS.harvest.z);
      if (d <= PADS.harvest.r + 1.4) this.goHarvest();
      else this.hud.toast('Walk to the HARVEST pad first', 'info', 'e-far', 2);
    }
  }

  private escape(): void {
    if (this.mode === 'UPGRADE_PANEL') this.closeUpgrades();
    else if (this.mode === 'PAUSED') {
      if (this.settingsPanel.confirming) this.settingsPanel.cancelConfirm();
      else this.closeSettings();
    } else if (this.mode === 'FARM' || this.mode === 'HARVEST') this.openSettings();
  }

  private openSettings(): void {
    if (this.mode !== 'FARM' && this.mode !== 'HARVEST') return;
    this.resumeMode = this.mode;
    this.setMode('PAUSED');
    this.settingsPanel.show(this.state.settings);
  }

  private closeSettings(): void {
    if (this.mode !== 'PAUSED') return;
    this.settingsPanel.hide();
    this.setMode(this.resumeMode);
    this.last = performance.now();
    this.acc = 0;
  }

  private openUpgrades(): void {
    if (this.mode !== 'FARM') return;
    this.resumeMode = 'FARM';
    this.setMode('UPGRADE_PANEL');
    const tab = this.state.stats.firstSaleDone && this.state.hauler.level === 0 && this.state.walletCents >= 22000 ? 'farm' : undefined;
    this.upgrades.show(this.state, tab);
    this.audio.play('uiClick');
  }

  private closeUpgrades(): void {
    if (this.mode !== 'UPGRADE_PANEL') return;
    this.upgrades.hide();
    this.setMode('FARM');
    this.acc = 0;
  }

  // ---- Player actions ------------------------------------------------------------------

  private selectTool(t: ToolId): void {
    if (this.mode !== 'HARVEST') return;
    if (this.sim.switchTool(t)) this.hud.bumpTool(t);
  }

  private buy(key: UpgradeKey): void {
    const s = this.state;
    if (key === 'hauler') {
      if (!s.stats.firstSaleDone && s.hauler.level === 0) {
        this.audio.play('uiDisabled');
        this.hud.toast('Sell your first bale to unlock', 'info', 'hauler-lock');
        return;
      }
      this.sim.buyHauler();
    } else {
      this.sim.buyUpgrade(key);
    }
    updateGoals(s, this.sim.events);
    this.upgrades.refresh(s);
    this.processEvents();
    this.requestSave(0.1);
  }

  private replant(): void {
    const info = this.sim.replantInfo();
    if (!info.available) {
      this.audio.play('uiDisabled');
      this.hud.toast(info.reason ?? 'Nothing to replant', 'info', 'replant-no');
      return;
    }
    this.sim.startReplant();
    this.processEvents();
    this.requestSave(0.2);
  }

  private packLeftovers(): void {
    if (this.sim.packLeftovers()) {
      this.hud.toast('Leftovers packed into mini-bales', 'good', 'pack');
      this.processEvents();
      this.requestSave(0.2);
    } else {
      this.audio.play('uiDisabled');
    }
  }

  applySettings(s: SettingsState, persist = true): void {
    const prevQuality = this.state.settings.quality;
    this.state.settings = { ...s };
    this.audio.applySettings(this.audioSettings(s));
    const reduced = s.reducedMotion;
    this.world.motionScale = reduced ? 0.35 : 1;
    this.frame.classList.toggle('reduced', reduced);
    if (s.quality !== prevQuality || !persist) {
      const lvl = this.pickQuality(s);
      if (lvl !== this.qualityLevel || !persist) {
        this.qualityLevel = lvl;
        if (persist) this.world.setQuality(QUALITY[lvl], this.renderer);
        else this.renderer.shadowMap.enabled = QUALITY[lvl].shadows;
        this.applyPixelRatio();
        this.resize();
      }
    }
    if (s.muted) this.hud.setAudioButton(false);
    if (persist) this.requestSave(0.3);
  }

  private resetSave(): void {
    clearSave();
    const s = createInitialState(Math.floor(Math.random() * 1e9), { ...this.state.settings });
    this.sim.setState(s);
    this.world.setState(s);
    this.recordPrev();
    this.settingsPanel.hide();
    this.setMode('FARM');
    this.cameraRig.snap(this.farmFraming());
    this.hud.toast('New farm started', 'good', 'reset');
    this.save();
  }

  // ---- Saving -----------------------------------------------------------------------------

  requestSave(delay = 0.5): void {
    if (this.saveSoon < 0 || this.saveSoon > delay) this.saveSoon = delay;
  }

  save(): void {
    // Never write while on the title screen: a damaged save must survive until the player chooses.
    if (this.mode === 'BOOT' || this.mode === 'TITLE') return;
    saveGame(this.state);
    this.autosaveT = 0;
  }

  // ---- Framing ------------------------------------------------------------------------------

  private titleFraming(): Framing {
    return { x: -0.3, z: -1.2, width: 11.5 };
  }

  private farmFraming(): Framing {
    const p = this.state.player;
    const c = CAMERA.farmClamp;
    return {
      x: Math.min(c.maxX, Math.max(c.minX, p.x * 0.5 - 0.4)),
      z: Math.min(c.maxZ, Math.max(c.minZ, p.z + CAMERA.farmOffsetZ)),
      width: CAMERA.farmViewWidth,
    };
  }

  private harvestFraming(): Framing {
    const h = this.state.harvester;
    const w = CAMERA.harvestViewWidth;
    const halfX = this.cameraRig.halfWidth(w);
    const halfZ = this.cameraRig.halfDepth(w);
    const maxX = Math.max(0, CAMERA.harvestVisibleHalfX - halfX);
    const lookX = (h.vx / 3.4) * 0.5;
    const lookZ = (h.vz / 3.4) * CAMERA.harvestLookahead;
    let z = h.z + CAMERA.harvestLead + lookZ;
    const zMin = CAMERA.harvestVisibleMinZ + halfZ;
    const zMax = CAMERA.harvestVisibleMaxZ - halfZ;
    z = zMin > zMax ? (zMin + zMax) / 2 : Math.min(zMax, Math.max(zMin, z));
    return { x: Math.min(maxX, Math.max(-maxX, h.x * 0.7 + lookX)), z, width: w };
  }

  // ---- Events --------------------------------------------------------------------------------

  private processEvents(): void {
    const events = this.sim.events.drain();
    for (const e of events) {
      this.world.handleEvent(e);
      this.onEvent(e);
    }
  }

  private screenOf(x: number, y: number, z: number): { x: number; y: number; on: boolean } {
    const v = this.tmpV.set(x, y, z).project(this.cameraRig.camera);
    return { x: ((v.x + 1) / 2) * this.frameW, y: ((1 - v.y) / 2) * this.frameH, on: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }

  private shake(amp: number): void {
    const s = this.state.settings;
    if (!s.shake || s.reducedMotion) return;
    this.cameraRig.shake(amp, JUICE.shakeDuration);
  }

  private onEvent(e: GameEvent): void {
    const s = this.state;
    const a = this.audio;
    switch (e.type) {
      case 'cellsCut': {
        const n = e.cells.length;
        a.play('cut', { intensity: n });
        if (n >= 14) this.shake(JUICE.shakeAmp * Math.min(1, n / 30));
        break;
      }
      case 'vacuumed':
        a.play('vacuumTick', { intensity: e.cells.length });
        break;
      case 'balePacked':
        a.play('pack', { volume: this.mode === 'HARVEST' ? 0.8 : 1 });
        // A small "+1 bale" pop near the top-right tells the player the vacuum is paying off.
        if (this.mode === 'HARVEST') this.hud.floatText('+1 bale', this.frameW - 58, 128, 'bale');
        if (e.mini) this.requestSave(0.2);
        break;
      case 'toolSwitchStart':
        a.play('toolSwap');
        break;
      case 'reachLimit':
        a.play('reachTap');
        break;
      case 'reachHint':
        this.reachHintT = 0;
        break;
      case 'pickup':
        if (e.carrier === 'player') {
          this.lastPickupPitch = 1 + Math.min(0.5, s.player.carry.length * 0.06);
          a.play('pickup', { pitch: this.lastPickupPitch });
        } else {
          a.play('pickup', { volume: 0.45, pitch: 0.95 });
        }
        break;
      case 'carryFull':
        a.play('full');
        this.hud.bumpCarry();
        this.hud.toast(`Hands full (${s.player.carry.length}/${CARRY.capacity(s.upgrades.carry)}) — deliver to the truck`, 'info', 'carry-full', 4);
        break;
      case 'deliver': {
        a.play('drop', { volume: e.carrier === 'player' ? 1 : 0.55 });
        if (s.truck.cargo.length % 3 === 0) a.play('truckLoad', { volume: 0.6 });
        const tp = this.screenOf(s.truck.x + TRUCK_LAYOUT.bedOffsetX, 1.6, TRUCK_LAYOUT.z);
        this.hud.floatText(`+${formatMoney(e.cents)}`, tp.x, tp.y, 'cash');
        this.requestSave(1);
        break;
      }
      case 'truckState':
        if (e.state === 'DEPARTING') this.hud.toast('Truck full — heading to market!', 'good', 'truck-go', 3);
        break;
      case 'cashCollected': {
        const p = this.screenOf(PADS.cash.x, 0.6, PADS.cash.z);
        const coins = Math.min(12, 2 + Math.round(e.cents / 800));
        this.hud.flyCoins(p.x, p.y, coins);
        this.hud.floatText(`+${formatMoney(e.cents)}`, p.x, p.y - 30, 'cash');
        this.cashTicks = Math.min(6, 2 + Math.round(e.cents / 1600));
        this.cashTickT = 0.28;
        this.requestSave(0.2);
        break;
      }
      case 'upgradeBought': {
        a.play('upgrade');
        const info = describeUpgrade(s, e.id);
        this.hud.toast(`${info.name} → Lv ${e.level}`, 'good', `up-${e.id}`, 0.5);
        if (e.id === 'reach') this.hud.toast(`Reach ${REACH.length(e.level).toFixed(1)} m — new rows unlocked`, 'info', 'reach-up', 0.5);
        this.requestSave(0.1);
        break;
      }
      case 'haulerBought':
        a.play('hire');
        this.hud.toast(e.level === 1 ? 'Hauler hired! They carry bales to the truck.' : `Hauler → Lv ${e.level}`, 'good', 'hire', 0.5);
        s.tutorial.seenHauler = true;
        this.requestSave(0.1);
        break;
      case 'purchaseFailed':
        a.play('uiDisabled');
        break;
      case 'hireNeedMoney':
        this.hud.toast(`Need ${e.need} more to hire a hauler`, 'info', 'hire-need', 3);
        a.play('uiDisabled');
        break;
      case 'levelUp':
        a.play('levelUp');
        this.hud.toast(`Level ${e.level}!`, 'good', 'lvl', 0.5);
        this.shake(JUICE.shakeAmp * 0.6);
        break;
      case 'replantStart':
        a.play('replant');
        this.hud.toast(`Replanting ${e.cells.length} patches…`, 'good', 'replant', 1);
        s.tutorial.seenReplant = true;
        break;
      case 'replantUnavailable':
        a.play('uiDisabled');
        break;
      case 'goalComplete':
        a.play('goal');
        this.hud.toast(`Goal complete: ${goalText(e.id)}`, 'good', `goal-${e.id}`, 1);
        this.requestSave(0.3);
        break;
      case 'footstep':
        if (e.carrier === 'player') a.play('footstep', { volume: 0.8 });
        else if (this.mode === 'FARM') a.play('footstep', { volume: 0.35, pan: this.panOf(s.hauler.x) });
        break;
      case 'requestHarvest':
        this.goHarvest();
        break;
      case 'openUpgrades':
        this.openUpgrades();
        break;
      default:
        break;
    }
  }

  private panOf(x: number): number {
    const f = this.cameraRig.framing;
    // Screen-right is −X.
    return Math.max(-1, Math.min(1, -(x - f.x) / 6));
  }

  // ---- Main loop -------------------------------------------------------------------------

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      this.frameStep(now);
    };
    requestAnimationFrame(loop);
  }

  private recordPrev(): void {
    const s = this.state;
    this.prev.tx = s.harvester.x;
    this.prev.tz = s.harvester.z;
    this.prev.px = s.player.x;
    this.prev.pz = s.player.z;
    this.prev.hx = s.hauler.x;
    this.prev.hz = s.hauler.z;
  }

  private frameStep(now: number): void {
    const rawDt = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(MAX_FRAME_DT, Math.max(0, rawDt));
    this.time += dt;
    this.trackFps(rawDt);

    this.input.update();
    const m = this.input.move;
    this.cameraRig.screenToGround(m.x, m.y, this.moveWorld);

    if (this.simulating) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= SIM_STEP && steps < MAX_SIM_STEPS_PER_FRAME) {
        this.recordPrev();
        this.sim.step(SIM_STEP, this.moveWorld);
        this.acc -= SIM_STEP;
        steps++;
      }
      if (steps >= MAX_SIM_STEPS_PER_FRAME) this.acc = 0;
    }
    this.processEvents();

    // Transitions finish when the camera move finishes (~460 ms).
    if (this.mode === 'TRANSITION_TO_HARVEST' || this.mode === 'TRANSITION_TO_FARM') {
      this.transT += dt;
      if (this.transT >= CAMERA.transitionTime && !this.cameraRig.transitioning) {
        this.setMode(this.mode === 'TRANSITION_TO_HARVEST' ? 'HARVEST' : 'FARM');
      }
    }

    // Camera
    const harvestView = this.mode === 'HARVEST' || this.mode === 'TRANSITION_TO_HARVEST';
    const farming = this.mode === 'FARM' || this.mode === 'TRANSITION_TO_FARM' || this.mode === 'UPGRADE_PANEL' || (this.mode === 'PAUSED' && this.resumeMode === 'FARM');
    const target = this.mode === 'TITLE' ? this.titleFraming() : harvestView || (this.mode === 'PAUSED' && this.resumeMode === 'HARVEST') ? this.harvestFraming() : farming ? this.farmFraming() : this.farmFraming();
    if (this.mode === 'TITLE') target.x += Math.sin(this.time * 0.15) * 0.8;
    this.cameraRig.update(dt, target, harvestView ? 0.16 : 0.12);
    const f = this.cameraRig.framing;
    this.camTarget.set(f.x, 0, f.z);

    const viewMode: ViewMode = this.mode === 'HARVEST' ? 'HARVEST' : this.mode === 'FARM' ? 'FARM' : 'TRANSITION';
    const alpha = this.simulating ? this.acc / SIM_STEP : 1;
    this.world.update(dt, alpha, viewMode, this.sim.rt, this.prev, this.camTarget);

    this.updateAudio(dt);
    this.updateHud(dt);
    this.updateAutosave(dt);

    this.renderer.render(this.world.scene, this.cameraRig.camera);
    this.debug?.update(dt);
  }

  private trackFps(rawDt: number): void {
    if (rawDt <= 0 || rawDt > 0.5) return;
    this.frameMs += (rawDt * 1000 - this.frameMs) * 0.05;
    this.fps = 1000 / this.frameMs;
    if (this.state.settings.quality !== 'auto' || !this.simulating) return;
    this.autoCheckT += rawDt;
    this.fpsWindow.push(rawDt);
    if (this.autoCheckT >= 4) {
      const avg = this.fpsWindow.reduce((a, b) => a + b, 0) / this.fpsWindow.length;
      this.fpsWindow.length = 0;
      this.autoCheckT = 0;
      // Step quality down once if sustained FPS is low (never auto-raise to avoid oscillation).
      if (1 / avg < 40 && this.qualityLevel !== 'low') {
        this.qualityLevel = this.qualityLevel === 'high' ? 'medium' : 'low';
        this.world.setQuality(QUALITY[this.qualityLevel], this.renderer);
        this.applyPixelRatio();
        this.resize();
      }
    }
  }

  private updateAudio(dt: number): void {
    const s = this.state;
    const rt = this.sim.rt;
    const h = s.harvester;
    const inHarvest = this.mode === 'HARVEST' || this.mode === 'TRANSITION_TO_HARVEST';
    this.audio.setHarvestLoops({
      inHarvest,
      bladeActive: inHarvest && h.tool === 'BLADE' && h.switchT <= 0,
      // Motor load follows how hard the disc is working (contacts and cutting drag).
      bladeLoad: clamp01(Math.max(rt.bladeContacts / 18, ((1 - rt.cutSpeedMul) / BLADE.maxDrag) * 0.9)),
      bladeLevel: s.upgrades.blade,
      vacuumActive: inHarvest && h.tool === 'VACUUM' && h.switchT <= 0,
      vacuumIntake: clamp01(rt.vacuumRate / VACUUM.intake(s.upgrades.vacuum)),
      vacuumLevel: s.upgrades.vacuum,
      toolSpeed: clamp01(rt.toolSpeed),
    });
    const tr = s.truck;
    let engine = 0;
    if (tr.state === 'ARRIVING' || tr.state === 'DEPARTING') {
      const d = Math.abs(tr.x - TRUCK_LAYOUT.dockX);
      engine = 0.9 * Math.max(0.15, 1 - d / 26);
    } else if (tr.state === 'LOADING') engine = 0.12;
    if (this.mode === 'HARVEST') engine *= 0.4;
    this.audio.setTruckEngine(engine, this.panOf(tr.x));
    // Stacked cash ticks for the count-up
    if (this.cashTicks > 0) {
      this.cashTickT += dt;
      if (this.cashTickT >= 0.07) {
        this.cashTickT = 0;
        this.cashTicks--;
        this.audio.play('cash', { intensity: this.cashTicks === 0 ? 0.8 : 0.3 });
      }
    }
    this.audio.update(dt);
  }

  private updateHud(dt: number): void {
    const s = this.state;
    const rt = this.sim.rt;
    const h = s.harvester;
    const inFarm = this.mode === 'FARM';
    const inHarvest = this.mode === 'HARVEST';

    // Periodic depletion check for the replant suggestion (cheap enough at 1 Hz).
    this.depletionT -= dt;
    if (this.depletionT <= 0) {
      this.depletionT = 1;
      const d = reachableDepletion(s.field, HOSE_ANCHOR.x, HOSE_ANCHOR.z, REACH.length(s.upgrades.reach));
      this.depletion = d.total > 0 ? d.depleted / d.total : 0;
    }
    const replantInfo = this.sim.replantInfo();
    const row = Math.floor((h.z - FIELD.z0) / FIELD.cell);
    const tier = tierForRow(Math.max(0, Math.min(FIELD.rows - 1, row)));
    this.hud.update(
      {
        walletCents: s.walletCents,
        level: s.level,
        xp: s.xp,
        xpToNext: XP.toNext(s.level),
        tool: h.tool,
        switching: h.switchT > 0,
        tierName: tier >= 0 ? TIERS[tier].name : null,
        tierIndex: Math.max(0, tier),
        carry: s.player.carry.length,
        carryCap: CARRY.capacity(s.upgrades.carry),
        replantAvailable: replantInfo.available,
        replantReason: replantInfo.reason,
        replantSuggest: this.depletion >= REPLANT.suggestFraction,
        replanting: this.sim.replanting,
        replantVisible: s.stats.unitsCollected > 0 || s.stats.replants > 0,
      },
      dt,
    );

    // Tutorial / hints / goals
    const ctxMode = inFarm || this.mode === 'TRANSITION_TO_FARM' || this.mode === 'UPGRADE_PANEL' ? 'FARM' : inHarvest || this.mode === 'TRANSITION_TO_HARVEST' ? 'HARVEST' : 'OTHER';
    this.tutorialView = updateTutorial(s, { mode: ctxMode, upgradePanelOpen: this.mode === 'UPGRADE_PANEL' });
    if (this.tutorialView && this.tutorialView.step === 8 && s.walletCents < 3500) {
      this.tutorialView = { ...this.tutorialView, text: 'Sell more bales for an upgrade', sub: `Blade Power costs 35 · you have ${formatMoney(s.walletCents)}` };
    }
    let extra: { text: string; sub?: string } | null = null;
    if (!this.tutorialView) {
      if (inFarm && s.stats.firstSaleDone && s.hauler.level === 0 && s.walletCents >= 22000 && !s.tutorial.seenHauler)
        extra = { text: 'Hire a hauler', sub: 'Stand on the HIRE pad' };
      else if (this.depletion >= REPLANT.suggestFraction && replantInfo.available) extra = { text: 'Crop running low', sub: inFarm ? 'Tap REPLANT for a fresh field — free' : 'Back to farm and REPLANT for free' };
    }
    const goal = s.tutorial.done ? currentGoal(s) : null;
    this.hud.setCoach(this.tutorialView, goal, extra);
    const tgt = this.tutorialView?.target ?? (extra?.text === 'Hire a hauler' ? 'pad:hauler' : null);
    this.world.setTutorialTarget(tgt, inFarm || this.mode === 'TRANSITION_TO_FARM');
    this.updateEdgeArrow(inFarm);

    // Pack leftovers near the depot
    const nearDepot = Math.hypot(s.player.x - PADS.depot.x, s.player.z - PADS.depot.z) < 2.6;
    this.hud.setPackButton(inFarm && nearDepot && this.sim.canPackLeftovers(), leftoverUnits(s.depot));

    this.updateLabels(dt, rt.zones.hauler);
  }

  private updateEdgeArrow(inFarm: boolean): void {
    const w = this.world.arrowWorld;
    if (!inFarm || !w) {
      this.hud.setEdgeArrow(null);
      return;
    }
    const p = this.screenOf(w.x, 0.5, w.z);
    const mx = 34;
    const top = 110;
    const bottom = this.frameH - 110;
    if (p.x >= mx && p.x <= this.frameW - mx && p.y >= top && p.y <= bottom) {
      this.hud.setEdgeArrow(null);
      return;
    }
    const cx = this.frameW / 2;
    const cy = this.frameH / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const k = Math.min(Math.abs((cx - mx) / (dx || 1e-3)), Math.abs(((dy < 0 ? cy - top : bottom - cy)) / (dy || 1e-3)));
    this.hud.setEdgeArrow({ x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dx, -dy) });
  }

  private updateLabels(dt: number, onHirePad: boolean): void {
    const s = this.state;
    const inFarmish = this.mode !== 'TITLE' && this.mode !== 'BOOT';
    const harvest = this.mode === 'HARVEST' || this.mode === 'TRANSITION_TO_HARVEST';

    // Depot stock
    const n = s.depot.bales.length;
    const pd = this.screenOf((PALLETS[0].x + PALLETS[1].x) / 2, n > 12 ? 2.2 : 1.7, PALLETS[0].z + 0.2);
    this.hud.label('depot', `${ICONS.bale}<span>${n} bale${n === 1 ? '' : 's'}</span>`, n > DEPOT_VISUAL_CAP ? 'cash' : '', pd.x, pd.y, inFarmish && !harvest && n > 0, true);

    // Truck
    const tr = s.truck;
    const tp = this.screenOf(tr.x + TRUCK_LAYOUT.bedOffsetX, 2.2, TRUCK_LAYOUT.z);
    let tText = '';
    let tCls = '';
    if (tr.state === 'LOADING') {
      tText = `${ICONS.truck}<span>${tr.cargo.length}/${TRUCK.capacity}</span>`;
      tCls = tr.cargo.length >= TRUCK.capacity ? 'cash' : '';
    } else if (tr.state === 'ARRIVING') {
      tText = `${ICONS.truck}<span>Truck arriving…</span>`;
      tCls = 'muted';
    } else {
      tText = `${ICONS.truck}<span>Next truck soon</span>`;
      tCls = 'muted';
    }
    const truckLblPos = tr.state === 'LOADING' || tr.state === 'ARRIVING' ? tp : this.screenOf(PADS.deliver.x, 1.2, PADS.deliver.z - 1.2);
    this.hud.label('truck', tText, tCls, truckLblPos.x, truckLblPos.y, inFarmish && !harvest, true);

    // Pending cash
    const pc = this.screenOf(PADS.cash.x, 1.1, PADS.cash.z + 0.3);
    this.hud.label('cash', `${ICONS.coin}<span>+${formatMoney(s.pendingCashCents)}</span>`, 'cash', pc.x, pc.y, inFarmish && !harvest && s.pendingCashCents > 0, true);

    // Hire pad
    const hireActive = this.sim.haulerPadActive();
    const hp = this.screenOf(PADS.hauler.x, 1.2, PADS.hauler.z);
    const afford = s.walletCents >= 22000;
    const hText = onHirePad
      ? afford
        ? `${ICONS.worker}<span>Hiring…</span>`
        : `${ICONS.worker}<span>Need ${Math.ceil((22000 - s.walletCents) / 100)} more</span>`
      : `${ICONS.worker}<span>Hire hauler · ${ICONS.coin}220</span>`;
    this.hud.label('hire', hText, afford ? 'cash' : '', hp.x, hp.y, inFarmish && !harvest && hireActive, true);

    // Workshop: nudge when something is affordable
    const affordable = (['blade', 'vacuum', 'reach', 'carry'] as const).some((k) => {
      const c = describeUpgrade(s, k).cost;
      return c !== null && s.walletCents >= c * 100;
    });
    const wp = this.screenOf(WORKSHOP.x, 3.0, WORKSHOP.z);
    this.hud.label('workshop', `${ICONS.gear}<span>Upgrade ready!</span>`, 'cash', wp.x, wp.y, inFarmish && !harvest && affordable && this.mode !== 'UPGRADE_PANEL', true);

    // Reach hint near the tool
    if (this.reachHintT >= 0) this.reachHintT += dt;
    if (this.reachHintT > 2.6) this.reachHintT = -1;
    const h = s.harvester;
    const rp = this.screenOf(h.x, 1.2, h.z);
    this.hud.label('reach', `${ICONS.hose}<span>Upgrade reach to harvest farther</span>`, 'warn', rp.x, rp.y - 20, harvest && this.reachHintT >= 0, true);
  }

  private updateAutosave(dt: number): void {
    if (this.mode === 'TITLE' || this.mode === 'BOOT') return;
    this.autosaveT += dt;
    if (this.saveSoon >= 0) {
      this.saveSoon -= dt;
      if (this.saveSoon <= 0) {
        this.saveSoon = -1;
        this.save();
      }
    }
    if (this.autosaveT >= AUTOSAVE_INTERVAL) this.save();
  }

  // ---- Debug hooks ----------------------------------------------------------------------------

  debugStats(): Record<string, number | string> {
    const info = this.renderer.info;
    const w = this.world.debugInfo();
    return {
      fps: Math.round(this.fps),
      frameMs: this.frameMs.toFixed(1),
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      particles: w.particles,
      flights: w.flights,
      quality: this.qualityLevel,
      mode: this.mode,
    };
  }

  debugRefreshField(): void {
    this.world.refreshField();
  }

  debugRebuildWorldState(): void {
    this.world.setState(this.state);
  }
}
