import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

let live = null;
const disposeScene = (scene) => scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) { for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); } });
const bytesFromBase64 = (data) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bin': 'application/octet-stream' };
window.LumenScanPreview = {
  dispose() { if (live) { cancelAnimationFrame(live.frame); live.ro.disconnect(); live.renderer.dispose(); live.maskMaterial.dispose(); disposeScene(live.scene); for (const url of live.urls) URL.revokeObjectURL(url); live = null; } },
  async capture() {
    if (!live) throw new Error('Load a phone scan before creating its projection images.');
    const { renderer, scene, camera, root, floor, maskMaterial, host } = live;
    const oldSize = renderer.getSize(new THREE.Vector2()), oldPixelRatio = renderer.getPixelRatio(), oldAspect = camera.aspect;
    const oldPosition = camera.position.clone(), oldQuaternion = camera.quaternion.clone(), oldBackground = scene.background, oldOverride = scene.overrideMaterial;
    const wasFloorVisible = floor.visible;
    try {
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root), sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const aspect = 16 / 9, halfVertical = THREE.MathUtils.degToRad(camera.fov / 2), halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
      const distance = Math.max(sphere.radius / Math.sin(halfVertical), sphere.radius / Math.sin(halfHorizontal)) * 1.12;
      const direction = oldPosition.clone().normalize();
      camera.position.copy(direction.multiplyScalar(distance)); camera.lookAt(0, 0, 0); camera.aspect = aspect; camera.updateProjectionMatrix();
      floor.visible = false; renderer.setPixelRatio(1); renderer.setSize(1280, 720, false);
      scene.background = new THREE.Color('#111820'); scene.overrideMaterial = null;
      renderer.render(scene, camera); const photo = renderer.domElement.toDataURL('image/png');
      scene.background = new THREE.Color('#000000'); scene.overrideMaterial = maskMaterial;
      renderer.render(scene, camera); const mask = renderer.domElement.toDataURL('image/png');
      if (photo.length > 14 * 1024 * 1024 || mask.length > 14 * 1024 * 1024) throw new Error('The rendered scan images exceed the ComfyUI upload limit.');
      return { photo, mask, width: 1280, height: 720 };
    } finally {
      floor.visible = wasFloorVisible; scene.background = oldBackground; scene.overrideMaterial = oldOverride;
      camera.position.copy(oldPosition); camera.quaternion.copy(oldQuaternion); camera.aspect = oldAspect; camera.updateProjectionMatrix();
      renderer.setPixelRatio(oldPixelRatio); renderer.setSize(oldSize.x, oldSize.y, false);
      renderer.render(scene, camera);
    }
  },
  async load(host, file, select, resources = []) {
    this.dispose(); host.replaceChildren();
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:100%;height:340px;display:block;touch-action:none;background:#0a111b'; host.appendChild(canvas);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#0a111b');
    const camera = new THREE.PerspectiveCamera(42, 1, 0.001, 1000); camera.position.set(0, 0.7, 2.6);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true }); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene.add(new THREE.HemisphereLight(0xc5e0ff, 0x343025, 2)); const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(3, 5, 4); scene.add(key);
    const root = new THREE.Group(); scene.add(root);
    const bytes = bytesFromBase64(file.data).buffer, ext = file.type, urls = [];
    const resourceByName = new Map((resources || []).map((item) => [String(item.name).toLowerCase(), item]));
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (/^(?:data:|blob:)/i.test(url)) return url;
      let name;
      try { name = decodeURIComponent(String(url).split(/[?#]/, 1)[0].replace(/\\/g, '/').split('/').pop()); } catch { throw new Error('The model contains an invalid linked asset URL.'); }
      const asset = resourceByName.get(name.toLowerCase());
      if (!asset) throw new Error(`The scan does not include linked file “${name}”. Upload the model and its linked files together.`);
      const data = bytesFromBase64(asset.data), mime = MIME[String(asset.type || '').toLowerCase()] || 'application/octet-stream';
      const objectUrl = URL.createObjectURL(new Blob([data], { type: mime })); urls.push(objectUrl); return objectUrl;
    });
    try {
      if (ext === '.glb' || ext === '.gltf') { const gltf = await new GLTFLoader(manager).parseAsync(bytes, ''); root.add(gltf.scene); }
      else if (ext === '.obj') {
        const objText = new TextDecoder().decode(bytes), materialFiles = [...objText.matchAll(/^\s*mtllib\s+(.+)$/gm)].flatMap((m) => m[1].trim().split(/\s+/));
        const creators = materialFiles.map((name) => resourceByName.get(name.split(/[\\/]/).pop().toLowerCase())).filter(Boolean).map((item) => new MTLLoader(manager).parse(new TextDecoder().decode(bytesFromBase64(item.data)), ''));
        const materials = { create(name) { const creator = creators.find((x) => Object.hasOwn(x.materialsInfo, name)); return creator ? creator.create(name) : new THREE.MeshStandardMaterial({ color: 0xc8b994, roughness: 0.82, side: THREE.DoubleSide }); } };
        creators.forEach((creator) => creator.preload()); root.add(new OBJLoader(manager).setMaterials(materials).parse(objText));
      }
      else if (ext === '.ply') { const g = new PLYLoader().parse(bytes); g.computeVertexNormals(); root.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xc8b994, roughness: 0.82, side: THREE.DoubleSide }))); }
      else throw new Error('3D preview supports GLB, GLTF, OBJ and PLY.');
    } catch (error) { disposeScene(scene); renderer.dispose(); for (const url of urls) URL.revokeObjectURL(url); host.replaceChildren(); throw new Error(`Could not preview this model: ${error.message}`); }
    const box = new THREE.Box3().setFromObject(root); if (box.isEmpty()) { disposeScene(scene); renderer.dispose(); for (const url of urls) URL.revokeObjectURL(url); host.replaceChildren(); throw new Error('The model contains no visible geometry.'); }
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3()); root.position.sub(center); root.scale.setScalar(1.8 / Math.max(size.x, size.y, size.z, 1e-5));
    const meshes = []; root.traverse((o) => { if (o.isMesh) { o.userData.scanName = o.name || `Surface ${meshes.length + 1}`; meshes.push(o); } });
    const floor = new THREE.GridHelper(2, 20, 0x34465c, 0x1f2b3a); floor.position.y = -0.95; scene.add(floor);
    const maskMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(); let down = null, chosen = null, frame;
    const resize = () => { const w = host.clientWidth || 480, h = 340; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }; resize();
    const ro = new ResizeObserver(resize); ro.observe(host);
    canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (down && (e.buttons & 1)) { root.rotation.y += (e.clientX - down[0]) * 0.009; root.rotation.x += (e.clientY - down[1]) * 0.009; down = [e.clientX, e.clientY]; } });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); camera.position.multiplyScalar(e.deltaY > 0 ? 1.08 : 0.92); }, { passive: false });
    canvas.addEventListener('click', (e) => { const r = canvas.getBoundingClientRect(); pointer.set((e.clientX-r.left)/r.width*2-1, -((e.clientY-r.top)/r.height)*2+1); ray.setFromCamera(pointer,camera); const hit=ray.intersectObjects(meshes,false)[0]; if(hit) { chosen=hit.object; select(chosen.uuid, chosen.userData.scanName); } });
    const draw = () => { if (live?.renderer !== renderer) return; renderer.render(scene,camera); live.frame=requestAnimationFrame(draw); }; live={ renderer,scene,camera,root,floor,maskMaterial,host,frame:0,ro,urls }; draw();
    return meshes.map((m, i) => ({ id:m.uuid, name:m.userData.scanName, index:i }));
  }
};
