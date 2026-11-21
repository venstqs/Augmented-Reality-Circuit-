/**
 * Floating component tags (clamped safely to stage bounds) + interactive inspector sheet.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, Pressable, Modal, TextInput, StyleSheet, Switch, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C } from './theme';
import { fmt, UNITS } from '../circuit/topology';

const NAMES = { battery: 'Battery', resistor: 'Resistor', bulb: 'Light bulb', led: 'LED', switch: 'Switch' };
const TYPES = [
  { key: 'battery', label: 'Battery', icon: 'battery-charging-outline' },
  { key: 'resistor', label: 'Resistor', icon: 'git-commit-outline' },
  { key: 'bulb', label: 'Bulb', icon: 'bulb-outline' },
  { key: 'led', label: 'LED', icon: 'sunny-outline' },
  { key: 'switch', label: 'Switch', icon: 'toggle-outline' },
];
const PRESETS = {
  battery: [1.5, 3, 5, 9, 12, 24],
  resistor: [10, 47, 100, 330, 1000, 4700, 10000],
  bulb: [4, 6, 12, 24, 48],
};
const TAG_W = 116;
const TAG_H = 44;

const shortVal = (v, unit) => (unit === 'Ω' && v >= 1000 ? `${+(v / 1000).toFixed(1)}k${unit}` : `${v}${unit}`);

export function ComponentTags({
  components,
  solution,
  toScreen,
  bounds,
  selectedId,
  onPress,
  onQuickToggle,
}) {
  return components.map((c) => {
    const p = toScreen({ x: c.box.x + c.box.w / 2, y: c.box.y });
    const r = solution?.elements?.[c.id];
    const unit = UNITS[c.type];
    const isSwitch = c.type === 'switch';
    const isClosed = c.closed !== false;
    const head = isSwitch
      ? (isClosed ? 'CLOSED' : 'OPEN')
      : unit
        ? shortVal(c.value, unit)
        : r?.state === 'burnt'
          ? 'BURNT'
          : r?.state === 'on'
            ? 'LIT'
            : 'OFF';
    const live = r && Math.abs(r.current) > 1e-6;
    const danger = r?.state === 'burnt' || r?.state === 'short';
    const selected = c.id === selectedId;

    const maxLeft = Math.max(bounds.left, bounds.right - TAG_W);
    const left = Math.min(Math.max(p[0] - TAG_W / 2, bounds.left), maxLeft);
    const maxTop = bounds.bottom != null ? Math.max(bounds.top, bounds.bottom - TAG_H) : Infinity;
    const top = Math.min(maxTop, Math.max(bounds.top, p[1] - 54));

    const accent = danger ? C.danger : selected ? C.cyan : live ? C.neon : C.faint;

    return (
      <Pressable
        key={c.id}
        onPress={() => onPress(c)}
        hitSlop={8}
        style={({ pressed }) => [
          styles.tag,
          { left, top, borderLeftColor: accent },
          selected && styles.tagSelected,
          danger && styles.tagDanger,
          pressed && { opacity: 0.78 },
        ]}
      >
        <View style={styles.tagRow}>
          <Text style={[styles.tagLabel, selected && { color: C.cyan }]} numberOfLines={1}>
            {c.label}
          </Text>
          {isSwitch && onQuickToggle ? (
            <Pressable
              hitSlop={6}
              onPress={(e) => {
                e.stopPropagation?.();
                onQuickToggle(c.id, !isClosed);
              }}
              style={[styles.switchPill, isClosed ? styles.switchOn : styles.switchOff]}
            >
              <Text style={[styles.switchPillText, { color: isClosed ? C.onNeon : C.amber }]}>
                {head}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.tagValue} numberOfLines={1}>
              {head}
            </Text>
          )}
          {typeof c.score === 'number' && !isSwitch && (
            <Text style={styles.confBadge}>{Math.round(c.score * 100)}%</Text>
          )}
        </View>
        <Text style={[styles.tagSub, { color: danger ? C.danger : live ? C.neon : C.faint }]} numberOfLines={1}>
          {r ? `${fmt(Math.abs(r.current), 'A')} · ${fmt(Math.abs(r.voltage), 'V')}` : 'disconnected'}
        </Text>
      </Pressable>
    );
  });
}

export function EditSheet({
  component,
  elementResult,
  batteryVoltage,
  onClose,
  onChange,
  onChangeType,
  onDelete,
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');

  useEffect(() => {
    if (component) setText(String(component.value ?? ''));
  }, [component?.id, component?.type, component?.value]);

  if (!component) return null;

  const unit = UNITS[component.type];
  const presets = PRESETS[component.type];
  const danger = elementResult?.state === 'burnt' || elementResult?.state === 'short';
  const showLedWarn = component.type === 'led' && elementResult?.state === 'burnt';
  const safeRes = batteryVoltage && batteryVoltage > 2.0
    ? Math.max(100, Math.ceil((batteryVoltage - 2.0) / 0.02 - 25))
    : 330;

  const commit = () => {
    const v = parseFloat(text.replace(',', '.'));
    if (unit && Number.isFinite(v) && v > 0 && v !== component.value) {
      onChange({ value: v });
    }
    onClose();
  };

  const pickPreset = (v) => {
    setText(String(v));
    if (v !== component.value) onChange({ value: v });
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={commit} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={commit} />
        <View style={[styles.sheet, { paddingBottom: 18 + insets.bottom }]}>
          <View style={styles.grabber} />

          <View style={styles.sheetHead}>
            <View style={{ flex: 1 }}>
              <View style={styles.kickerRow}>
                <Text style={styles.sheetKicker}>{component.label}</Text>
                {component.nodes?.length === 2 && (
                  <View style={styles.metaPill}>
                    <Text style={styles.metaText}>N{component.nodes[0]} → N{component.nodes[1]}</Text>
                  </View>
                )}
                {typeof component.score === 'number' && (
                  <View style={[styles.metaPill, { backgroundColor: C.cyanSoft }]}>
                    <Text style={[styles.metaText, { color: C.cyan }]}>
                      {Math.round(component.score * 100)}% match
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.sheetTitle}>{NAMES[component.type]}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={C.dim} />
            </Pressable>
          </View>

          {elementResult && (
            <View style={[styles.telemetry, danger && styles.telemetryDanger]}>
              <Metric label="Current" value={fmt(Math.abs(elementResult.current || 0), 'A')} color={danger ? C.danger : C.neon} />
              <View style={styles.telemetrySep} />
              <Metric label="Drop" value={fmt(Math.abs(elementResult.voltage || 0), 'V')} />
              <View style={styles.telemetrySep} />
              <Metric label="Power" value={fmt(Math.abs(elementResult.power || 0), 'W')} />
            </View>
          )}

          {!!unit && (
            <>
              <View style={styles.row}>
                <Text style={styles.label}>{component.type === 'battery' ? 'Voltage' : 'Resistance'}</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    value={text}
                    onChangeText={setText}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                    onSubmitEditing={commit}
                    selectTextOnFocus
                  />
                  <Text style={styles.unit}>{unit}</Text>
                </View>
              </View>
              {presets && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.presets}
                  keyboardShouldPersistTaps="handled"
                >
                  {presets.map((v) => {
                    const on = Number(text) === v;
                    return (
                      <Pressable key={v} onPress={() => pickPreset(v)} style={[styles.preset, on && styles.presetOn]}>
                        <Text style={[styles.presetText, on && { color: C.onNeon }]}>{shortVal(v, unit)}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </>
          )}

          {component.type === 'switch' && (
            <View style={styles.row}>
              <View>
                <Text style={styles.label}>Switch contact</Text>
                <Text style={styles.subLabel}>{component.closed !== false ? 'Closed — circuit connected' : 'Open — circuit broken'}</Text>
              </View>
              <Switch
                value={component.closed !== false}
                onValueChange={(v) => onChange({ closed: v })}
                trackColor={{ true: C.neon }}
              />
            </View>
          )}

          {(component.type === 'battery' || component.type === 'led') && (
            <View style={styles.row}>
              <View>
                <Text style={styles.label}>Flip polarity</Text>
                <Text style={styles.subLabel}>Swap anode / positive direction</Text>
              </View>
              <Switch
                value={!!component.flipped}
                onValueChange={(v) => onChange({ flipped: v })}
                trackColor={{ true: C.cyan }}
              />
            </View>
          )}

          {showLedWarn ? (
            <View style={styles.warnBox}>
              <Ionicons name="warning-outline" size={16} color={C.danger} style={{ marginTop: 1 }} />
              <Text style={styles.warnText}>
                Overcurrent! Above 30 mA burns out this LED. Add or increase a series resistor to ≥ {safeRes} Ω.
              </Text>
            </View>
          ) : component.type === 'led' ? (
            <Text style={styles.note}>LEDs only conduct one way. If it stays dark in a closed loop, try flipping polarity.</Text>
          ) : null}

          {onChangeType && (
            <View style={{ gap: 8 }}>
              <Text style={styles.secKicker}>PART TYPE (FIX MISREAD OR SWAP)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presets}>
                {TYPES.map((t) => {
                  const active = t.key === component.type;
                  return (
                    <Pressable
                      key={t.key}
                      onPress={() => !active && onChangeType(component.id, t.key)}
                      style={[styles.typeChip, active && styles.typeChipOn]}
                    >
                      <Ionicons name={t.icon} size={14} color={active ? '#021418' : C.dim} />
                      <Text style={[styles.typeChipText, active && { color: '#021418' }]}>{t.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <View style={styles.footerRow}>
            {onDelete && (
              <Pressable
                style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.75 }]}
                onPress={() => onDelete(component.id)}
              >
                <Ionicons name="trash-outline" size={17} color={C.danger} />
                <Text style={styles.deleteText}>Remove</Text>
              </Pressable>
            )}
            <Pressable style={({ pressed }) => [styles.done, pressed && { opacity: 0.85 }]} onPress={commit}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Metric({ label, value, color }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricVal, color && { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    position: 'absolute',
    width: TAG_W,
    minHeight: TAG_H,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(10,13,22,0.90)',
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 3,
  },
  tagSelected: {
    borderColor: C.cyan,
    backgroundColor: 'rgba(10,22,36,0.95)',
  },
  tagDanger: {
    borderColor: C.danger,
    backgroundColor: 'rgba(60,0,16,0.92)',
  },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tagLabel: { color: C.dim, fontWeight: '800', fontSize: 10, letterSpacing: 0.4 },
  tagValue: { color: C.text, fontWeight: '800', fontSize: 12, flex: 1 },
  confBadge: { color: C.faint, fontSize: 9, fontWeight: '700', fontVariant: ['tabular-nums'] },
  switchPill: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    marginLeft: 'auto',
  },
  switchOn: { backgroundColor: C.neon },
  switchOff: { backgroundColor: C.amberSoft, borderWidth: 1, borderColor: 'rgba(255,204,51,0.4)' },
  switchPillText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4 },
  tagSub: { fontSize: 10, fontVariant: ['tabular-nums'], marginTop: 2, fontWeight: '600' },

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
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  sheetKicker: { color: C.neon, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  metaPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: C.glassLight },
  metaText: { color: C.dim, fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sheetTitle: { color: C.text, fontSize: 22, fontWeight: '800' },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.glassLight, alignItems: 'center', justifyContent: 'center' },

  telemetry: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceRaised,
    borderRadius: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  telemetryDanger: { borderColor: 'rgba(255,77,109,0.5)', backgroundColor: 'rgba(255,77,109,0.08)' },
  telemetrySep: { width: StyleSheet.hairlineWidth * 2, alignSelf: 'stretch', backgroundColor: C.border },
  metric: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  metricLabel: { color: C.dim, fontSize: 9.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  metricVal: { color: C.text, fontSize: 15, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 42 },
  label: { color: C.text, fontSize: 15.5, fontWeight: '600' },
  subLabel: { color: C.dim, fontSize: 11.5, marginTop: 1 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.glassLight, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: C.border },
  input: { color: C.text, fontSize: 20, minWidth: 86, paddingVertical: 7, textAlign: 'right', fontWeight: '700' },
  unit: { color: C.neon, fontSize: 18, marginLeft: 6, fontWeight: '700' },
  presets: { gap: 7 },
  preset: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10, backgroundColor: C.glassLight, borderWidth: 1, borderColor: C.border },
  presetOn: { backgroundColor: C.neon, borderColor: C.neon },
  presetText: { color: C.text, fontWeight: '700', fontSize: 13 },

  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: C.dangerSoft,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,77,109,0.35)',
  },
  warnText: { color: C.danger, fontSize: 12.5, lineHeight: 17, fontWeight: '600', flex: 1 },
  note: { color: C.dim, fontSize: 12.5, lineHeight: 18 },

  secKicker: { color: C.dim, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.9 },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: C.glassLight,
    borderWidth: 1,
    borderColor: C.border,
  },
  typeChipOn: { backgroundColor: C.cyan, borderColor: C.cyan },
  typeChipText: { color: C.dim, fontSize: 12.5, fontWeight: '700' },

  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: C.dangerSoft,
    borderWidth: 1,
    borderColor: 'rgba(255,77,109,0.35)',
  },
  deleteText: { color: C.danger, fontWeight: '800', fontSize: 14 },
  done: { flex: 1, backgroundColor: C.neon, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  doneText: { color: C.onNeon, fontWeight: '800', fontSize: 16 },
});
