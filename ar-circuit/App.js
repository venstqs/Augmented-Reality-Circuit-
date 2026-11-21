import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Image, Animated, Easing, Linking, AppState,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import Scene3D from './src/ar/Scene3D';
import { ComponentTags, EditSheet } from './src/ui/ComponentTags';
import { InspectionBoxes, ScanGuideModal } from './src/ui/ScanOverlay';
import { C } from './src/ui/theme';
import { DEMOS } from './src/circuit/demo';
import { solveCircuit } from './src/circuit/solver';
import { buildWireSegments, toSolverElements, DEFAULT_VALUES, fmt } from './src/circuit/topology';
import { isModelAvailable, loadDetector } from './src/ml/detector';
import { analyzePhoto, nextComponentId } from './src/ml/scanner';

const cloneList = (list) => list.map((c) => ({
  ...c,
  box: c.box ? { ...c.box } : c.box,
  nodes: c.nodes ? [...c.nodes] : c.nodes,
  terminals: c.terminals ? c.terminals.map((p) => ({ ...p })) : c.terminals,
}));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const haptic = (fn) => { try { fn(); } catch (_e) { /* haptics unsupported */ } };

const ZOOM_STEPS = [
  { label: '1×', val: 0 },
  { label: '1.5×', val: 0.12 },
  { label: '2×', val: 0.25 },
];

const STATUS = {
  closed: { text: 'Circuit closed · current flowing', color: C.neon, icon: 'pulse' },
  open: { text: 'Open circuit · no current', color: C.amber, icon: 'remove-circle-outline' },
  short: { text: 'Short circuit!', color: C.danger, icon: 'alert-circle' },
  'no-source': { text: 'No power source found', color: C.amber, icon: 'battery-dead-outline' },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [size, setSize] = useState({ W: 1, H: 1 });
  const [topH, setTopH] = useState(112);
  const [bottomH, setBottomH] = useState(190);

  const [mode, setMode] = useState('scan'); // 'scan' | 'demo'
  const [phase, setPhase] = useState('live'); // scan: 'live' | 'capturing' | 'analyzing' | 'result'
  const [photo, setPhoto] = useState(null);
  const [demoIdx, setDemoIdx] = useState(0);
  const [components, setComponents] = useState([]);
  const [textBoxes, setTextBoxes] = useState([]);
  const [nodeCount, setNodeCount] = useState(0);
  const [imageSize, setImageSize] = useState(null);
  const [electronMode, setElectronMode] = useState(false);
  const [editing, setEditing] = useState(null);
  const [scanMsg, setScanMsg] = useState(null);
  const [timings, setTimings] = useState(null);

  const [torch, setTorch] = useState(false);
  const [zoomIdx, setZoomIdx] = useState(0);
  const [showBoxes, setShowBoxes] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [scanModified, setScanModified] = useState(false);
  const rawScanRef = useRef(null);

  const [modelStatus, setModelStatus] = useState(isModelAvailable() ? 'idle' : 'missing');
  const [modelMsg, setModelMsg] = useState('');
  const modelPromise = useRef(null);

  /* ------------------------------ permissions ------------------------------- */
  useEffect(() => {
    if (permission && !permission.granted && permission.status === 'undetermined' && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission?.status]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') getPermission(); });
    return () => sub.remove();
  }, [getPermission]);

  /* ------------------------------ model loading ----------------------------- */
  const ensureModel = useCallback(() => {
    if (!isModelAvailable()) { setModelStatus('missing'); return Promise.resolve(false); }
    if (!modelPromise.current) {
      setModelStatus('loading');
      modelPromise.current = loadDetector(setModelMsg)
        .then((ok) => { setModelStatus(ok ? 'ready' : 'missing'); return ok; })
        .catch((e) => {
          console.warn(e);
          modelPromise.current = null;
          setModelStatus('error');
          setModelMsg(String(e?.message || e));
          return false;
        });
    }
    return modelPromise.current;
  }, []);

  useEffect(() => {
    if (mode !== 'scan' || !cameraReady) return;
    const t = setTimeout(ensureModel, 1000);
    return () => clearTimeout(t);
  }, [mode, cameraReady, ensureModel]);

  /* ------------------------------ mode switching ----------------------------- */
  const resetScan = () => {
    setPhase('live');
    setPhoto(null);
    setComponents([]);
    setTextBoxes([]);
    setNodeCount(0);
    setImageSize(null);
    setScanMsg(null);
    setTimings(null);
    setEditing(null);
    setFocusMode(false);
    setPanelCollapsed(false);
    setScanModified(false);
    rawScanRef.current = null;
  };

  const goScan = () => {
    if (mode === 'scan') return;
    setMode('scan');
    resetScan();
    haptic(() => Haptics.selectionAsync());
  };

  const pickDemo = (i) => {
    setMode('demo');
    setDemoIdx(i);
    setComponents(cloneList(DEMOS[i].components));
    setTextBoxes([]);
    setNodeCount(DEMOS[i].nodeCount);
    setImageSize(null);
    setPhoto(null);
    setScanMsg(null);
    setTimings(null);
    setEditing(null);
    setFocusMode(false);
    setScanModified(false);
    rawScanRef.current = null;
    setTorch(false);
    setCameraReady(false);
    haptic(() => Haptics.selectionAsync());
  };

  /* --------------------------------- scanning -------------------------------- */
  const capture = async () => {
    if (!cameraRef.current || !cameraReady || phase !== 'live') return;
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
    setScanMsg(null);
    setPhase('capturing');
    let shot;
    try {
      shot = await cameraRef.current.takePictureAsync({ quality: 0.6, shutterSound: false });
    } catch (e) {
      setPhase('live');
      setScanMsg(`Couldn't take a photo: ${e?.message || e}`);
      return;
    }
    setTorch(false);
    setPhoto(shot);
    setPhase('analyzing');
    await tick(120);

    const ok = await ensureModel();
    if (!ok) {
      setPhase('result');
      setScanMsg(isModelAvailable() ? 'The detector failed to load. Tap Retake to try again.' : 'No detector model is bundled with this build.');
      return;
    }
    try {
      const r = await analyzePhoto(shot.uri);
      rawScanRef.current = cloneList(r.components);
      setScanModified(false);
      setComponents(r.components);
      setTextBoxes(r.textBoxes || []);
      setNodeCount(r.nodeCount);
      setImageSize(r.imageSize);
      setTimings(r.timings);
      setPhase('result');
      if (!r.components.length) {
        setScanMsg('No circuit parts recognised. Dark ink on white paper, good light, or open the ? guide.');
        haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
      }
    } catch (e) {
      console.warn(e);
      setPhase('result');
      setScanMsg(`Analysis failed: ${e?.message || e}`);
    }
  };

  /* ------------------------------- simulation ------------------------------- */
  const solution = useMemo(() => solveCircuit(toSolverElements(components), nodeCount), [components, nodeCount]);
  const segments = useMemo(() => buildWireSegments(components, solution), [components, solution]);

  const prevStatus = useRef(solution.status);
  useEffect(() => {
    if (prevStatus.current !== solution.status && components.length) {
      if (solution.status === 'closed') haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
      if (solution.status === 'short') haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
    }
    prevStatus.current = solution.status;
  }, [solution.status, components.length]);

  /* --------------------------- coordinate mapping --------------------------- */
  const showPanel = (mode === 'demo' || phase === 'result') && !focusMode;

  const stage = useMemo(() => {
    const y = (focusMode ? insets.top + 8 : topH + 8);
    const bot = showPanel ? bottomH : insets.bottom + 12;
    return { x: 0, y, w: size.W, h: Math.max(1, size.H - bot - y - 8) };
  }, [size, topH, bottomH, focusMode, showPanel, insets]);

  const fitRect = useMemo(() => {
    if (mode === 'demo') {
      const pad = 16;
      return { x: stage.x + pad, y: stage.y + 36, w: stage.w - pad * 2, h: Math.max(1, stage.h - 40) };
    }
    const iw = imageSize?.width || photo?.width || 3;
    const ih = imageSize?.height || photo?.height || 4;
    const s = Math.min(stage.w / iw, stage.h / ih);
    const w = iw * s;
    const h = ih * s;
    return { x: stage.x + (stage.w - w) / 2, y: stage.y + (stage.h - h) / 2, w, h };
  }, [mode, stage, imageSize, photo]);

  const toScreen = useCallback((p) => [fitRect.x + p.x * fitRect.w, fitRect.y + p.y * fitRect.h], [fitRect]);
  const toWorld = useCallback(
    (p) => {
      const [sx, sy] = toScreen(p);
      return [sx - size.W / 2, size.H / 2 - sy];
    },
    [toScreen, size]
  );

  /* -------------------------- component editing ----------------------------- */
  const updateComponent = (id, patch) => {
    setComponents((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setEditing((e) => (e && e.id === id ? { ...e, ...patch } : e));
    if (mode === 'scan') setScanModified(true);
    if ('closed' in patch || 'flipped' in patch) haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  };

  const changeComponentType = (id, nextType) => {
    const current = components.find((c) => c.id === id);
    if (!current) return;
    const newId = nextComponentId(nextType, components.filter((x) => x.id !== id));
    const nextComp = {
      ...current,
      id: newId,
      label: newId,
      type: nextType,
      value: DEFAULT_VALUES[nextType],
      closed: true,
      flipped: false,
    };
    setComponents((cs) => cs.map((c) => (c.id === id ? nextComp : c)));
    setEditing(nextComp);
    if (mode === 'scan') setScanModified(true);
    haptic(() => Haptics.selectionAsync());
  };

  const deleteComponent = (id) => {
    setComponents((cs) => cs.filter((c) => c.id !== id));
    setEditing(null);
    if (mode === 'scan') setScanModified(true);
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  };

  const restoreRawScan = () => {
    if (!rawScanRef.current) return;
    setComponents(cloneList(rawScanRef.current));
    setScanModified(false);
    setEditing(null);
    haptic(() => Haptics.selectionAsync());
  };

  /* -------------------------------- derived ---------------------------------- */
  const hasCircuit = components.length > 0;
  const battery = components.find((c) => c.type === 'battery');
  const totalPower = components.reduce(
    (s, c) => (c.type === 'battery' ? s : s + (solution.elements?.[c.id]?.power || 0)),
    0
  );
  const absI = Math.abs(solution.totalCurrent || 0);
  const rEqVal = solution.status === 'open'
    ? '∞ Ω'
    : battery && absI > 1e-6 && solution.status === 'closed'
      ? fmt(battery.value / absI, 'Ω')
      : '—';

  const st = hasCircuit ? STATUS[solution.status] : null;
  const granted = !!permission?.granted;
  const showCamera = mode === 'scan' && granted;
  const tagBounds = {
    left: 8,
    right: Math.max(130, size.W - 8),
    top: topH + 4,
    bottom: showPanel ? Math.max(topH + 60, size.H - bottomH - 6) : size.H - insets.bottom - 12,
  };

  /* -------------------------------- render ---------------------------------- */
  return (
    <View style={styles.root} onLayout={(e) => setSize({ W: e.nativeEvent.layout.width, H: e.nativeEvent.layout.height })}>
      {/* ------------------------------ background ----------------------------- */}
      {mode === 'demo' && <GridBackdrop />}
      {showCamera && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          animateShutter={false}
          enableTorch={showCamera && phase === 'live' && torch}
          zoom={ZOOM_STEPS[zoomIdx].val}
          isPinchToZoomEnabled
          onCameraReady={() => setCameraReady(true)}
          onMountError={(e) => setScanMsg(`Camera error: ${e?.message || 'could not start camera'}`)}
        />
      )}
      {mode === 'scan' && photo && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg }]}>
          <Image
            source={{ uri: photo.uri }}
            style={[styles.photo, { left: fitRect.x, top: fitRect.y, width: fitRect.w, height: fitRect.h }]}
            resizeMode="cover"
          />
          {phase === 'analyzing' && <ScanSweep rect={fitRect} />}
        </View>
      )}

      {/* ------------------------------- AR layer ------------------------------- */}
      {hasCircuit && (
        <>
          <Scene3D
            components={components}
            solution={solution}
            segments={segments}
            toWorld={toWorld}
            electronMode={electronMode}
            selectedId={editing?.id}
          />
          {showBoxes && !focusMode && (
            <InspectionBoxes
              components={components}
              textBoxes={textBoxes}
              toScreen={toScreen}
              selectedId={editing?.id}
            />
          )}
          {!focusMode && (
            <ComponentTags
              components={components}
              solution={solution}
              toScreen={toScreen}
              bounds={tagBounds}
              selectedId={editing?.id}
              onPress={setEditing}
              onQuickToggle={(id, closed) => updateComponent(id, { closed })}
            />
          )}
        </>
      )}

      {/* ------------------------- scan: live viewfinder ------------------------ */}
      {mode === 'scan' && granted && (phase === 'live' || phase === 'capturing') && (
        <Viewfinder stage={stage} />
      )}

      {/* --------------------------- permission screen -------------------------- */}
      {mode === 'scan' && !granted && (
        <PermissionScreen permission={permission} onRequest={requestPermission} onDemo={() => pickDemo(0)} insets={insets} />
      )}

      {/* -------------------------------- top HUD ------------------------------- */}
      {focusMode ? (
        <View style={[styles.focusTop, { top: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable
            onPress={() => setFocusMode(false)}
            style={styles.focusPill}
            hitSlop={8}
          >
            <Ionicons name="eye-outline" size={16} color={C.neon} />
            <Text style={styles.focusText}>Show HUD</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none" onLayout={(e) => setTopH(e.nativeEvent.layout.height)}>
          <View style={styles.titleRow}>
            <View style={styles.brand}>
              <View style={styles.brandIcon}>
                <Ionicons name="flash" size={14} color={C.onNeon} />
              </View>
              <Text style={styles.brandText}>CircuitLens</Text>
            </View>
            <View style={styles.topActions}>
              <View style={styles.segment}>
                <SegBtn label="Scan" icon="scan-outline" on={mode === 'scan'} onPress={goScan} />
                <SegBtn label="Demo" icon="flask-outline" on={mode === 'demo'} onPress={() => pickDemo(demoIdx)} />
              </View>
              {hasCircuit && (
                <Pressable
                  onPress={() => setFocusMode(true)}
                  hitSlop={6}
                  style={styles.iconBtn}
                  accessibilityLabel="Hide HUD overlay"
                >
                  <Ionicons name="eye-off-outline" size={16} color={C.dim} />
                </Pressable>
              )}
              <Pressable
                onPress={() => setGuideOpen(true)}
                hitSlop={6}
                style={styles.iconBtn}
                accessibilityLabel="Drawing guide"
              >
                <Ionicons name="help-circle-outline" size={18} color={C.dim} />
              </Pressable>
            </View>
          </View>

          {st && (
            <View style={styles.statusRow} pointerEvents="box-none">
              <View style={[styles.status, { borderColor: st.color + '66' }]}>
                <Ionicons name={st.icon} size={14} color={st.color} />
                <Text style={[styles.statusText, { color: st.color }]}>{st.text}</Text>
              </View>
              {mode === 'scan' && timings && (
                <View style={styles.metaChip}>
                  <Text style={styles.metaChipText}>
                    {components.length} parts · {(timings.total / 1000).toFixed(1)}s
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {/* ---------------------------- scan controls ---------------------------- */}
      {mode === 'scan' && granted && !showPanel && !focusMode && (
        <View
          style={[styles.shutterArea, { paddingBottom: insets.bottom + 20 }]}
          pointerEvents="box-none"
          onLayout={(e) => setBottomH(e.nativeEvent.layout.height)}
        >
          {scanMsg ? (
            <View style={[styles.toast, styles.toastWarn]}>
              <Ionicons name="alert-circle" size={16} color={C.amber} />
              <Text style={styles.toastText}>{scanMsg}</Text>
            </View>
          ) : phase === 'analyzing' ? (
            <View style={styles.toast}>
              <ActivityIndicator color={C.neon} size="small" />
              <Text style={styles.toastText}>
                {modelStatus === 'loading' ? modelMsg || 'Loading detector…' : 'Reading schematic & tracing wires…'}
              </Text>
            </View>
          ) : (
            <ModelChip status={modelStatus} msg={modelMsg} cameraReady={cameraReady} onGuide={() => setGuideOpen(true)} />
          )}

          <View style={styles.shutterRow}>
            <Pressable
              onPress={() => setTorch((t) => !t)}
              disabled={phase !== 'live'}
              style={({ pressed }) => [
                styles.camBtn,
                torch && styles.camBtnOn,
                phase !== 'live' && { opacity: 0.4 },
                pressed && { opacity: 0.75 },
              ]}
              accessibilityLabel="Toggle flashlight"
            >
              <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={20} color={torch ? C.onNeon : C.text} />
              <Text style={[styles.camBtnLabel, torch && { color: C.onNeon }]}>{torch ? 'On' : 'Light'}</Text>
            </Pressable>

            <Pressable
              onPress={capture}
              disabled={!cameraReady || phase !== 'live'}
              style={({ pressed }) => [styles.shutter, (!cameraReady || phase !== 'live') && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.94 }] }]}
              accessibilityLabel="Scan circuit"
            >
              <View style={styles.shutterInner}>
                {phase === 'live' ? <Ionicons name="scan-outline" size={30} color={C.onNeon} /> : <ActivityIndicator color={C.onNeon} />}
              </View>
            </Pressable>

            <Pressable
              onPress={() => setZoomIdx((z) => (z + 1) % ZOOM_STEPS.length)}
              disabled={phase !== 'live'}
              style={({ pressed }) => [
                styles.camBtn,
                zoomIdx > 0 && styles.camBtnCyan,
                phase !== 'live' && { opacity: 0.4 },
                pressed && { opacity: 0.75 },
              ]}
              accessibilityLabel="Cycle camera zoom"
            >
              <Text style={[styles.zoomNum, zoomIdx > 0 && { color: '#021418' }]}>{ZOOM_STEPS[zoomIdx].label}</Text>
              <Text style={[styles.camBtnLabel, zoomIdx > 0 && { color: '#021418' }]}>Zoom</Text>
            </Pressable>
          </View>

          <Text style={styles.shutterHint}>{phase === 'live' ? 'Tap shutter to scan circuit' : ' '}</Text>
        </View>
      )}

      {/* ----------------------------- bottom panel ----------------------------- */}
      {showPanel && (
        <View style={[styles.panel, { paddingBottom: insets.bottom + 12 }]} onLayout={(e) => setBottomH(e.nativeEvent.layout.height)}>
          <View style={styles.panelHead}>
            {mode === 'demo' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ flex: 1 }}>
                {DEMOS.map((d, i) => (
                  <Pressable key={d.key} onPress={() => pickDemo(i)} style={[styles.chip, demoIdx === i && styles.chipOn]}>
                    <Text style={[styles.chipText, demoIdx === i && { color: C.onNeon }]}>{d.title}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.panelTitle}>
                {hasCircuit ? 'Live Circuit Telemetry' : 'Scan Result'}
              </Text>
            )}
            {hasCircuit && (
              <Pressable
                onPress={() => setPanelCollapsed((v) => !v)}
                hitSlop={10}
                style={styles.collapseBtn}
                accessibilityLabel={panelCollapsed ? 'Expand panel' : 'Collapse panel'}
              >
                <Ionicons name={panelCollapsed ? 'chevron-up' : 'chevron-down'} size={18} color={C.dim} />
              </Pressable>
            )}
          </View>

          {!panelCollapsed && (
            <>
              {scanMsg && (
                <View style={[styles.toast, styles.toastWarn, { alignSelf: 'stretch' }]}>
                  <Ionicons name="alert-circle" size={16} color={C.amber} />
                  <Text style={styles.toastText}>{scanMsg}</Text>
                </View>
              )}

              {solution.warnings.length > 0 && (
                <View style={styles.warn}>
                  {solution.warnings.map((w) => (
                    <Text key={w} style={styles.warnText}>⚠ {w}</Text>
                  ))}
                </View>
              )}

              {hasCircuit && (
                <View style={styles.stats}>
                  <Stat label="Source" value={battery ? `${battery.value} V` : '—'} />
                  <View style={styles.statDivider} />
                  <Stat label="Current" value={fmt(absI, 'A')} accent />
                  <View style={styles.statDivider} />
                  <Stat label="Eq. Load" value={rEqVal} />
                  <View style={styles.statDivider} />
                  <Stat label="Power" value={fmt(totalPower, 'W')} />
                </View>
              )}
            </>
          )}

          <View style={styles.actions}>
            {hasCircuit && (
              <Pressable style={[styles.pill, electronMode && styles.pillCyan]} onPress={() => setElectronMode((v) => !v)}>
                <Ionicons name="swap-horizontal" size={15} color={electronMode ? '#021418' : C.text} />
                <Text style={[styles.pillText, electronMode && { color: '#021418' }]}>
                  {electronMode ? 'Electrons' : 'Current'}
                </Text>
              </Pressable>
            )}
            {hasCircuit && (
              <Pressable style={[styles.pill, showBoxes && styles.pillPurple]} onPress={() => setShowBoxes((v) => !v)}>
                <Ionicons name="scan" size={14} color={showBoxes ? '#080514' : C.text} />
                <Text style={[styles.pillText, showBoxes && { color: '#080514' }]}>
                  {showBoxes ? 'Boxes On' : 'X-Ray'}
                </Text>
              </Pressable>
            )}
            {mode === 'scan' && scanModified && rawScanRef.current && (
              <Pressable style={styles.pill} onPress={restoreRawScan}>
                <Ionicons name="refresh-outline" size={15} color={C.amber} />
                <Text style={[styles.pillText, { color: C.amber }]}>Undo edits</Text>
              </Pressable>
            )}
            {mode === 'scan' && (
              <Pressable style={[styles.pill, styles.pillPrimary]} onPress={resetScan}>
                <Ionicons name="camera-outline" size={15} color={C.onNeon} />
                <Text style={[styles.pillText, { color: C.onNeon }]}>Retake</Text>
              </Pressable>
            )}
          </View>

          {!panelCollapsed && hasCircuit && (
            <Text style={styles.hint}>
              Tap any tag to adjust values or swap part type · tap switch pills to flip
            </Text>
          )}
        </View>
      )}

      <EditSheet
        component={editing}
        elementResult={editing ? solution.elements?.[editing.id] : null}
        batteryVoltage={battery?.value}
        onClose={() => setEditing(null)}
        onChange={(p) => editing && updateComponent(editing.id, p)}
        onChangeType={changeComponentType}
        onDelete={deleteComponent}
      />

      <ScanGuideModal visible={guideOpen} onClose={() => setGuideOpen(false)} />
    </View>
  );
}

/* ================================ sub-views ================================= */

function SegBtn({ label, icon, on, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.segBtn, on && styles.segOn]} hitSlop={4}>
      <Ionicons name={icon} size={14} color={on ? C.onNeon : C.dim} />
      <Text style={[styles.segText, on && { color: C.onNeon }]}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value, accent }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, accent && { color: C.neon }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function ModelChip({ status, msg, cameraReady, onGuide }) {
  let icon = 'checkmark-circle';
  let color = C.neon;
  let text = 'Fit drawing inside corners · Tap ? for tips';
  if (!cameraReady) { icon = 'camera-outline'; color = C.dim; text = 'Starting camera…'; }
  else if (status === 'loading') { icon = null; text = msg || 'Loading detector…'; }
  else if (status === 'missing') { icon = 'alert-circle'; color = C.amber; text = 'No detector model bundled — try Demo'; }
  else if (status === 'error') { icon = 'alert-circle'; color = C.danger; text = 'Detector failed to load — tap scan to retry'; }
  return (
    <Pressable onPress={onGuide} style={styles.toast}>
      {icon ? <Ionicons name={icon} size={16} color={color} /> : <ActivityIndicator color={C.neon} size="small" />}
      <Text style={styles.toastText}>{text}</Text>
    </Pressable>
  );
}

/** Corner brackets showing where to put the drawing. */
function Viewfinder({ stage }) {
  const w = Math.min(stage.w - 48, (stage.h - 24) * 0.75);
  const h = w / 0.75;
  const left = stage.x + (stage.w - w) / 2;
  const top = stage.y + (stage.h - h) / 2;
  const L = 28;
  const corner = { position: 'absolute', width: L, height: L, borderColor: C.neon };
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left, top, width: w, height: h }}>
      <View style={[corner, { left: 0, top: 0, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 14 }]} />
      <View style={[corner, { right: 0, top: 0, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 14 }]} />
      <View style={[corner, { left: 0, bottom: 0, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 14 }]} />
      <View style={[corner, { right: 0, bottom: 0, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 14 }]} />
    </View>
  );
}

/** Animated scan line over the captured photo while the detector runs. */
function ScanSweep({ rect }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, rect.h - 3)] });
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, overflow: 'hidden', borderRadius: 16 }}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(3,10,8,0.35)' }]} />
      <Animated.View style={[styles.sweep, { transform: [{ translateY }] }]} />
    </View>
  );
}

/** Subtle engineering grid behind demo circuits. */
function GridBackdrop() {
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const step = 28;
  const cols = Math.ceil(dims.w / step);
  const rows = Math.ceil(dims.h / step);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg }]} pointerEvents="none" onLayout={(e) => setDims({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {Array.from({ length: cols }, (_, i) => (
        <View key={`c${i}`} style={[styles.gridLine, { left: i * step, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, opacity: i % 4 === 0 ? 0.12 : 0.05 }]} />
      ))}
      {Array.from({ length: rows }, (_, i) => (
        <View key={`r${i}`} style={[styles.gridLine, { top: i * step, left: 0, right: 0, height: StyleSheet.hairlineWidth, opacity: i % 4 === 0 ? 0.12 : 0.05 }]} />
      ))}
    </View>
  );
}

function PermissionScreen({ permission, onRequest, onDemo, insets }) {
  const blocked = permission && !permission.granted && !permission.canAskAgain;
  return (
    <View style={[StyleSheet.absoluteFill, styles.perm, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 24 }]}>
      {!permission ? (
        <ActivityIndicator color={C.neon} />
      ) : (
        <>
          <View style={styles.permIcon}>
            <Ionicons name="camera-outline" size={36} color={C.neon} />
          </View>
          <Text style={styles.permTitle}>{blocked ? 'Camera access is off' : 'Point your camera at a circuit'}</Text>
          <Text style={styles.permText}>
            {blocked
              ? 'CircuitLens needs the camera to read hand-drawn schematics. Turn it on in Settings, then come back.'
              : 'CircuitLens reads hand-drawn schematics and overlays a live 3D simulation of the current flow.'}
          </Text>
          <Pressable style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]} onPress={blocked ? () => Linking.openSettings() : onRequest}>
            <Ionicons name={blocked ? 'settings-outline' : 'camera-outline'} size={18} color={C.onNeon} />
            <Text style={styles.ctaText}>{blocked ? 'Open Settings' : 'Allow camera'}</Text>
          </Pressable>
          <Pressable style={styles.ctaGhost} onPress={onDemo}>
            <Text style={styles.ctaGhostText}>Try a demo circuit instead</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

/* ================================== styles ================================== */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  photo: { position: 'absolute', borderRadius: 16 },
  sweep: { position: 'absolute', left: 0, right: 0, height: 3, backgroundColor: C.neon, shadowColor: C.neon, shadowOpacity: 1, shadowRadius: 12, elevation: 8 },
  gridLine: { position: 'absolute', backgroundColor: C.cyan },

  focusTop: { position: 'absolute', right: 16 },
  focusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 8,
    borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderStrong,
  },
  focusText: { color: C.text, fontSize: 12.5, fontWeight: '800' },

  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14, paddingBottom: 8, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandIcon: { width: 26, height: 26, borderRadius: 8, backgroundColor: C.neon, alignItems: 'center', justifyContent: 'center' },
  brandText: { color: C.text, fontSize: 17, fontWeight: '800', letterSpacing: 0.2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  segment: { flexDirection: 'row', padding: 3, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  segBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, paddingVertical: 6.5, borderRadius: 11 },
  segOn: { backgroundColor: C.neon },
  segText: { color: C.dim, fontWeight: '700', fontSize: 12.5 },
  iconBtn: {
    width: 34, height: 34, borderRadius: 12, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  status: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 5.5,
    borderRadius: 20, borderWidth: 1, backgroundColor: C.surface,
  },
  statusText: { fontSize: 12, fontWeight: '700' },
  metaChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  metaChipText: { color: C.dim, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },

  shutterArea: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  shutterRow: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  camBtn: {
    width: 54, height: 54, borderRadius: 18, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.borderStrong, alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  camBtnOn: { backgroundColor: C.amber, borderColor: C.amber },
  camBtnCyan: { backgroundColor: C.cyan, borderColor: C.cyan },
  camBtnLabel: { color: C.dim, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4 },
  zoomNum: { color: C.text, fontSize: 13.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  shutter: {
    width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: C.neon, alignItems: 'center', justifyContent: 'center' },
  shutterHint: { color: C.text, fontSize: 12, fontWeight: '600', marginTop: -2, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 6 },

  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, maxWidth: '100%',
  },
  toastWarn: { borderColor: 'rgba(255,204,51,0.4)' },
  toastText: { color: C.text, fontSize: 12.5, flexShrink: 1, lineHeight: 17 },

  panel: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 14, gap: 10,
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth * 2, borderColor: C.border,
  },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelTitle: { flex: 1, color: C.dim, fontSize: 11.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  collapseBtn: {
    width: 30, height: 30, borderRadius: 10, backgroundColor: C.glassLight,
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  chips: { gap: 8 },
  chip: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7.5, backgroundColor: C.glassLight, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: C.neon, borderColor: C.neon },
  chipText: { color: C.text, fontSize: 12, fontWeight: '700' },
  warn: { backgroundColor: 'rgba(255,77,109,0.12)', borderRadius: 12, padding: 10, gap: 2, borderWidth: 1, borderColor: 'rgba(255,77,109,0.28)' },
  warnText: { color: C.danger, fontWeight: '700', fontSize: 12 },
  stats: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.glassLight, borderRadius: 16, paddingVertical: 10, borderWidth: 1, borderColor: C.border },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 3 },
  statDivider: { width: StyleSheet.hairlineWidth * 2, alignSelf: 'stretch', backgroundColor: C.border },
  statLabel: { color: C.dim, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700' },
  statValue: { color: C.text, fontSize: 16, fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 7, justifyContent: 'center', flexWrap: 'wrap' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.glassLight, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: C.border,
  },
  pillPrimary: { backgroundColor: C.neon, borderColor: C.neon },
  pillCyan: { backgroundColor: C.cyan, borderColor: C.cyan },
  pillPurple: { backgroundColor: C.purple, borderColor: C.purple },
  pillText: { color: C.text, fontWeight: '700', fontSize: 12.5 },
  hint: { color: C.faint, fontSize: 11, textAlign: 'center' },

  perm: { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },
  permIcon: { width: 76, height: 76, borderRadius: 24, backgroundColor: 'rgba(61,255,181,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  permTitle: { color: C.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  permText: { color: C.dim, textAlign: 'center', fontSize: 15, lineHeight: 22, marginBottom: 10 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.neon, paddingHorizontal: 26, paddingVertical: 14, borderRadius: 16 },
  ctaText: { color: C.onNeon, fontWeight: '800', fontSize: 16 },
  ctaGhost: { paddingVertical: 12, paddingHorizontal: 16 },
  ctaGhostText: { color: C.dim, fontWeight: '700', fontSize: 14 },
});
