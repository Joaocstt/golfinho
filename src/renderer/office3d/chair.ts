// Cadeira de escritório (a mesma do Golfinho Call), usada quando a mesa não tem a gamer.
import * as THREE from "three";

export function makeChair(color: THREE.ColorRepresentation): THREE.Group {
  const g = new THREE.Group();
  const seatMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.4, metalness: 0.6 });
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  part(new THREE.BoxGeometry(0.55, 0.08, 0.52), seatMat, 0, 0.5, 0);
  part(new THREE.BoxGeometry(0.55, 0.6, 0.07), seatMat, 0, 0.86, 0.26).rotation.x = -0.1;
  part(new THREE.CylinderGeometry(0.04, 0.04, 0.42, 10), metal, 0, 0.27, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = part(new THREE.BoxGeometry(0.05, 0.04, 0.32), metal, Math.sin(a) * 0.15, 0.05, Math.cos(a) * 0.15);
    leg.rotation.y = a;
  }
  return g;
}
