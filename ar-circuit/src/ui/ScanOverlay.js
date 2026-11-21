/**
 * Vision X-Ray overlay (bounding boxes, confidence scores, color-coded net pins)
 * + in-app Schematic Drawing & Scanning Guide modal.
 */
import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C } from './theme';

const TYPE_COLOR = {
  battery: C.amber,
  resistor: C.cyan,
  bulb: '#ffd166',
  led: C.neon,
  switch: C.purple,
};

const NET_COLORS = ['#3dffb5', '#4de1ff', '#ffcc33', '#b78bfa', '#ff6b8b', '#7ef29a'];
const netColor = (n) => NET_COLORS[Math.abs(n ?? 0) % NET_COLORS.length];

export function InspectionBoxes({ components, textBoxes = [], toScreen, selectedId }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {textBoxes.map((box, idx) => {
        const [x0, y0] = toScreen({ x: box.x, y: box.y });
        const [x1, y1] = toScreen({ x: box.x + box.w, y: box.y + box.h });
        const w = Math.max(8, x1 - x0);
        const h = Math.max(8, y1 - y0);
        return (
          <View key={`txt-${idx}`} style={[styles.textBox, { left: x0, top: y0, width: w, height: h }]}>
            <Text style={styles.textBadge}>TXT</Text>
          </View>
        );
      })}

      {components.map((c) => {
        const [x0, y0] = toScreen({ x: c.box.x, y: c.box.y });
        const [x1, y1] = toScreen({ x: c.box.x + c.box.w, y: c.box.y + c.box.h });
        const w = Math.max(12, x1 - x0);
        const h = Math.max(12, y1 - y0);
        const color = TYPE_COLOR[c.type] || C.text;
        const selected = c.id === selectedId;
        const pct = typeof c.score === 'number' ? ` ${Math.round(c.score * 100)}%` : '';

        return (
          <React.Fragment key={`box-${c.id}`}>
            <View
              style={[
                styles.box,
                { left: x0, top: y0, width: w, height: h, borderColor: color },
                selected && { borderWidth: 2.5, backgroundColor: color + '18' },
              ]}
            >
              <View style={[styles.badge, { backgroundColor: color }]}>
                <Text style={styles.badgeText}>
                  {c.id}{pct}
                </Text>
              </View>
            </View>

            {c.terminals?.map((pt, t) => {
              const [px, py] = toScreen(pt);
              const n = c.nodes?.[t];
              const nc = netColor(n);
              return (
                <View key={`${c.id}-n${t}`} style={[styles.pinWrap, { left: px - 12, top: py - 12 }]}>
                  <View style={[styles.pinDot, { borderColor: nc }]}>
                    <Text style={[styles.pinText, { color: nc }]}>N{n ?? '?'}</Text>
                  </View>
                </View>
              );
            })}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const GUIDE_PARTS = [
  {
    name: 'Battery / Source',
    hint: 'Long & short parallel plates, or DC circle source',
    color: C.amber,
    glyph: 'battery',
  },
  {
    name: 'Resistor',
    hint: 'Sharp 3–4 peak zig-zag along the wire',
    color: C.cyan,
    glyph: 'resistor',
  },
  {
    name: 'Light Bulb',
    hint: 'Circle with × cross or filament loop inside',
    color: '#ffd166',
    glyph: 'bulb',
  },
  {
    name: 'LED / Diode',
    hint: 'Triangle against bar with two light arrows',
    color: C.neon,
    glyph: 'led',
  },
  {
    name: 'Switch',
    hint: 'Wire break with raised lever & contact dots',
    color: C.purple,
    glyph: 'switch',
  },
];

function SymbolGlyph({ glyph, color }) {
  if (glyph === 'battery') {
    return (
      <View style={styles.glyphBox}>
        <View style={[styles.gWire, { width: 10, backgroundColor: color }]} />
        <View style={[styles.gPlateLong, { backgroundColor: color }]} />
        <View style={{ width: 4 }} />
        <View style={[styles.gPlateShort, { backgroundColor: color }]} />
        <View style={[styles.gWire, { width: 10, backgroundColor: color }]} />
      </View>
    );
  }
  if (glyph === 'resistor') {
    return (
      <View style={styles.glyphBox}>
        <Ionicons name="pulse-outline" size={26} color={color} />
      </View>
    );
  }
  if (glyph === 'bulb') {
    return (
      <View style={styles.glyphBox}>
        <View style={[styles.gCircle, { borderColor: color }]}>
          <Ionicons name="close" size={16} color={color} />
        </View>
      </View>
    );
  }
  if (glyph === 'led') {
    return (
      <View style={styles.glyphBox}>
        <Ionicons name="play-outline" size={20} color={color} />
        <View style={[styles.gBarVert, { backgroundColor: color }]} />
        <Ionicons name="arrow-up-outline" size={12} color={color} style={{ marginLeft: 2, marginTop: -12, transform: [{ rotate: '40deg' }] }} />
      </View>
    );
  }
  return (
    <View style={styles.glyphBox}>
      <View style={[styles.gDot, { backgroundColor: color }]} />
      <View style={[styles.gLever, { backgroundColor: color }]} />
      <View style={[styles.gDot, { backgroundColor: color, marginLeft: 14 }]} />
    </View>
  );
}

export function ScanGuideModal({ visible, onClose }) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: 22 + insets.bottom }]}>
        <View style={styles.grabber} />
        <View style={styles.head}>
          <View>
            <Text style={styles.kicker}>SCANNER GUIDE</Text>
            <Text style={styles.title}>How to get accurate scans</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Ionicons name="close" size={20} color={C.dim} />
          </Pressable>
        </View>

        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
          <View style={styles.tipsCard}>
            <TipRow icon="contrast-outline" text="Use dark ink or marker on plain unlined white paper." />
            <TipRow icon="git-commit-outline" text="Close every corner cleanly — gaps break circuit loops." />
            <TipRow icon="flashlight-outline" text="Use the Torch button in dim rooms and fill the corner frame." />
          </View>

          <Text style={styles.secLabel}>RECOGNIZED SCHEMATIC SYMBOLS</Text>
          <View style={styles.grid}>
            {GUIDE_PARTS.map((p) => (
              <View key={p.name} style={styles.partCard}>
                <SymbolGlyph glyph={p.glyph} color={p.color} />
                <Text style={[styles.partName, { color: p.color }]}>{p.name}</Text>
                <Text style={styles.partHint}>{p.hint}</Text>
              </View>
            ))}
          </View>

          <View style={styles.editTip}>
            <Ionicons name="construct-outline" size={16} color={C.cyan} />
            <Text style={styles.editTipText}>
              Wrong part type or extra box? Tap any component tag after scanning to retype it, adjust values, flip polarity, or delete it.
            </Text>
          </View>
        </ScrollView>

        <Pressable style={({ pressed }) => [styles.gotIt, pressed && { opacity: 0.85 }]} onPress={onClose}>
          <Text style={styles.gotItText}>Got it</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function TipRow({ icon, text }) {
  return (
    <View style={styles.tipRow}>
      <Ionicons name={icon} size={16} color={C.neon} style={{ marginTop: 1 }} />
      <Text style={styles.tipText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderWidth: 1.5,
    borderRadius: 8,
  },
  badge: {
    position: 'absolute',
    top: -15,
    left: -1,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
  },
  badgeText: {
    color: '#031018',
    fontSize: 9.5,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  textBox: {
    position: 'absolute',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,204,51,0.55)',
    borderRadius: 5,
  },
  textBadge: {
    position: 'absolute',
    top: -12,
    left: 0,
    fontSize: 8.5,
    fontWeight: '800',
    color: C.amber,
    backgroundColor: 'rgba(14,18,30,0.85)',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  pinWrap: {
    position: 'absolute',
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDot: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 8,
    backgroundColor: 'rgba(7,10,18,0.92)',
    borderWidth: 1.25,
  },
  pinText: {
    fontSize: 8.5,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: C.surfaceSolid,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 14,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderColor: C.border,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: C.border },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { color: C.neon, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  title: { color: C.text, fontSize: 20, fontWeight: '800' },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.glassLight, alignItems: 'center', justifyContent: 'center' },

  tipsCard: {
    backgroundColor: C.glassLight,
    borderRadius: 14,
    padding: 12,
    gap: 9,
    borderWidth: 1,
    borderColor: C.border,
  },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  tipText: { color: C.text, fontSize: 13, lineHeight: 18, flex: 1 },

  secLabel: { color: C.dim, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  partCard: {
    width: '48.5%',
    backgroundColor: C.surfaceRaised,
    borderRadius: 14,
    padding: 11,
    gap: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  partName: { fontSize: 13, fontWeight: '800', marginTop: 2 },
  partHint: { color: C.dim, fontSize: 11.5, lineHeight: 15 },

  glyphBox: { height: 28, flexDirection: 'row', alignItems: 'center' },
  gWire: { height: 2, borderRadius: 1 },
  gPlateLong: { width: 2.5, height: 20, borderRadius: 1 },
  gPlateShort: { width: 3, height: 11, borderRadius: 1 },
  gCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.8, alignItems: 'center', justifyContent: 'center' },
  gBarVert: { width: 2.5, height: 16, borderRadius: 1, marginLeft: -4 },
  gDot: { width: 6, height: 6, borderRadius: 3 },
  gLever: { width: 16, height: 2, borderRadius: 1, marginBottom: 8, marginRight: -12, transform: [{ rotate: '-26deg' }] },

  editTip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: C.cyanSoft,
    borderRadius: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: 'rgba(77,225,255,0.25)',
  },
  editTipText: { color: C.text, fontSize: 12.5, lineHeight: 17, flex: 1 },

  gotIt: { backgroundColor: C.neon, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  gotItText: { color: C.onNeon, fontWeight: '800', fontSize: 15 },
});

