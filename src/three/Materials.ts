import * as THREE from 'three';
import { COLORS, ENV, TUNING, type MarbleColor } from '../config/GameConfig';

/** Shared geometry + materials. One instance each, reused everywhere. */

export const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  screwHead: new THREE.CylinderGeometry(1, 1, 1, 22),
  socket: new THREE.CylinderGeometry(1, 1, 1, 18),
};

/** Polished coloured resin — candy marble, not glass. Readability first. */
export function marbleMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.13,
    metalness: 0.0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.1,
  });
}

/** Tinted acrylic chamber walls — the batch inside must stay readable. */
export function acrylicMaterial(color: MarbleColor, opacity = 0.24) {
  return new THREE.MeshPhysicalMaterial({
    color: COLORS[color].light,
    transparent: true,
    opacity,
    roughness: 0.12,
    metalness: 0,
    clearcoat: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

export function frameMaterial(hex: number = ENV.frame) {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0.08 });
}

export function plasticMaterial(color: MarbleColor) {
  return new THREE.MeshPhysicalMaterial({
    color: COLORS[color].hex,
    roughness: 0.28,
    metalness: 0.0,
    clearcoat: 0.6,
  });
}

export function metalMaterial(hex: number = ENV.metal, rough = 0.32) {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0.72 });
}

export function rubberMaterial(hex: number = ENV.rubber) {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: 0.86, metalness: 0.05 });
}

/** A box helper that keeps the shared geometry and just scales it. */
export function box(w: number, h: number, d: number, mat: THREE.Material) {
  const m = new THREE.Mesh(GEO.box, mat);
  m.scale.set(w, h, d);
  return m;
}

/** Rounded-ish slab: a box with a thin bright top edge, cheap bevel read. */
export function slab(w: number, h: number, d: number, mat: THREE.Material) {
  const g = new THREE.Group();
  g.add(box(w, h, d, mat));
  return g;
}
