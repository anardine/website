const loadButton = document.getElementById('load');
const resetButton = document.getElementById('reset');
const status = document.getElementById('status');
const viewport = document.getElementById('viewport');
let disposeViewer = null;

loadButton.addEventListener('click', async () => {
  loadButton.disabled = true;
  status.textContent = 'Loading 3D model...';
  let renderer;
  let loadedModel;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const skeletons = new Set();
  let controls;
  let observer;
  let dracoLoader;
  const trackResources = (child) => {
    if (child.geometry) geometries.add(child.geometry);
    if (child.skeleton) skeletons.add(child.skeleton);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    childMaterials.filter(Boolean).forEach((value) => materials.add(value));
  };
  const cleanup = () => {
    observer?.disconnect();
    controls?.dispose();
    dracoLoader?.dispose();
    loadedModel?.traverse(trackResources);
    skeletons.forEach((skeleton) => skeleton.dispose());
    materials.forEach((material) => {
      Object.values(material).filter((value) => value?.isTexture).forEach((texture) => textures.add(texture));
    });
    const images = new Set();
    textures.forEach((texture) => {
      if (texture.source?.data?.close) images.add(texture.source.data);
      texture.dispose();
    });
    images.forEach((image) => image.close());
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    renderer?.dispose();
    renderer?.domElement.remove();
    resetButton.onclick = null;
  };
  try {
    // Resolve against the article's path, not this viewer's nested asset path.
    const path = new URLSearchParams(location.search).get('model');
    if (!path) throw new Error('No model file specified.');
    const modelUrl = new URL(path, new URL('../../../post/', location.href));
    const modelRoot = new URL('../../../images/posts_images/', location.href);
    if (modelUrl.origin !== modelRoot.origin || !modelUrl.pathname.startsWith(modelRoot.pathname) ||
        !/\.(stl|obj|usdz|gltf|glb)$/i.test(modelUrl.pathname)) {
      throw new Error('Invalid model file URL.');
    }
    const isObj = modelUrl.pathname.toLowerCase().endsWith('.obj');
    const isUsdz = modelUrl.pathname.toLowerCase().endsWith('.usdz');
    const isGltf = /\.(gltf|glb)$/i.test(modelUrl.pathname);
    const [THREE, loaderModule, { OrbitControls }] = await Promise.all([
      import('three'),
      isGltf ? import('three/addons/loaders/GLTFLoader.js') :
        isUsdz ? import('three/addons/loaders/USDLoader.js') :
        isObj ? import('three/addons/loaders/OBJLoader.js') : import('three/addons/loaders/STLLoader.js'),
      import('three/addons/controls/OrbitControls.js'),
    ]);
    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status}).`);
    if (isGltf) {
      const [{ DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/addons/loaders/DRACOLoader.js'),
        import('three/addons/libs/meshopt_decoder.module.js'),
      ]);
      dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/libs/draco/gltf/');
      const loader = new loaderModule.GLTFLoader();
      loader.setDRACOLoader(dracoLoader);
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(await response.arrayBuffer(), new URL('.', modelUrl).href);
      gltf.scenes.forEach((scene) => scene.traverse(trackResources));
      loadedModel = gltf.scene;
      if (!loadedModel) throw new Error('The glTF file contains no default scene.');
    } else if (isUsdz) {
      const buffer = await response.arrayBuffer();
      await new Promise((resolve, reject) => {
        loadedModel = new loaderModule.USDLoader().parse(buffer, '', resolve, reject);
      });
    } else {
      loadedModel = isObj
        ? new loaderModule.OBJLoader().parse(await response.text())
        : new THREE.Mesh(new loaderModule.STLLoader().parse(await response.arrayBuffer()));
    }
    // Normalize a wrapper so authored transforms and unit scaling survive.
    const model = new THREE.Group();
    model.add(loadedModel);
    const nonMeshes = [];
    model.traverse((child) => {
      trackResources(child);
      if (child.isLine || child.isPoints) nonMeshes.push(child);
    });
    nonMeshes.forEach((child) => child.removeFromParent());
    let meshCount = 0;
    const material = isUsdz || isGltf ? null :
      new THREE.MeshStandardMaterial({ color: 0x7894ab, roughness: 0.65, side: THREE.DoubleSide });
    if (material) materials.add(material);
    model.traverse((child) => {
      if (!child.isMesh) return;
      const positions = child.geometry.getAttribute('position');
      if (!positions || positions.count < 3 || !positions.array.every(Number.isFinite)) {
        throw new Error('The model contains invalid triangles.');
      }
      meshCount++;
      if ((!isObj && !isUsdz && !isGltf) || !child.geometry.hasAttribute('normal')) child.geometry.computeVertexNormals();
      if (material) child.material = material;
    });
    if (!meshCount) throw new Error('The model contains no triangles.');
    const bounds = new THREE.Box3().setFromObject(model);
    const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    if (!Number.isFinite(radius) || radius <= 0) throw new Error('The model has no visible size.');
    model.position.copy(bounds.getCenter(new THREE.Vector3())).multiplyScalar(-1 / radius);
    model.scale.setScalar(1 / radius);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xf5f5f5);
    viewport.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    camera.up.set(0, isObj || isUsdz || isGltf ? 1 : 0, isObj || isUsdz || isGltf ? 0 : 1);
    scene.add(model);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, -4, 5);
    scene.add(light);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 1.2;
    controls.maxDistance = 20;
    const render = () => renderer.render(scene, camera);
    const reset = () => {
      controls.target.set(0, 0, 0);
      const distance = 1.2 / Math.sin(Math.atan(Math.tan(Math.PI / 8) * Math.min(camera.aspect, 1)));
      camera.position.set(distance * 0.6, -distance * 0.8, distance * 0.5);
      controls.update();
      render();
    };
    controls.addEventListener('change', render);
    // Render on interaction/resize only, with no idle animation loop.
    observer = new ResizeObserver(() => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    });
    camera.aspect = viewport.clientWidth / Math.max(viewport.clientHeight, 1);
    camera.updateProjectionMatrix();
    reset();
    observer.observe(viewport);
    resetButton.onclick = reset;
    resetButton.hidden = false;
    loadButton.hidden = true;
    status.textContent = 'Drag to rotate; right-drag to pan; scroll or pinch to zoom.';
    disposeViewer = cleanup;
  } catch (error) {
    cleanup();
    status.textContent = `Could not load model: ${error.message} Check the file, connection, and WebGL support.`;
    loadButton.textContent = 'Retry loading model';
    loadButton.disabled = false;
  }
});

window.addEventListener('pagehide', (event) => {
  if (!event.persisted) disposeViewer?.();
});
