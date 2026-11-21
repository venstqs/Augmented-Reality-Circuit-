import { StyleSheet } from 'react-native';

export const C = {
  bg: '#070a12',
  surface: 'rgba(14, 18, 30, 0.88)',
  surfaceSolid: '#0e121e',
  surfaceRaised: '#151b2c',
  glass: 'rgba(14, 18, 30, 0.78)',
  glassLight: 'rgba(255,255,255,0.07)',
  border: 'rgba(255,255,255,0.12)',
  borderStrong: 'rgba(255,255,255,0.22)',
  text: '#eef2ff',
  dim: '#8b93a7',
  faint: '#5a6275',
  neon: '#3dffb5',
  neonSoft: 'rgba(61,255,181,0.14)',
  onNeon: '#03140d',
  cyan: '#4de1ff',
  cyanSoft: 'rgba(77,225,255,0.14)',
  amber: '#ffcc33',
  amberSoft: 'rgba(255,204,51,0.14)',
  danger: '#ff4d6d',
  dangerSoft: 'rgba(255,77,109,0.14)',
  purple: '#b78bfa',
};

export const glass = {
  backgroundColor: C.glass,
  borderColor: C.border,
  borderWidth: StyleSheet.hairlineWidth * 2,
  borderRadius: 18,
};
