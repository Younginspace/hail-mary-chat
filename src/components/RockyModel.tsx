import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

interface Props {
  isSpeaking: boolean;
}

export default function RockyModel({ isSpeaking }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const speakingRef = useRef(false);

  useEffect(() => {
    speakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // OrbitControls — zoom + manual rotate + slow auto spin
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 0.5;
    controls.maxDistance = 50;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    controls.minPolarAngle = Math.PI * 0.25;
    controls.maxPolarAngle = Math.PI * 0.75;
    // Track if user is interacting
    let userInteracting = false;
    let lastInteractTime = 0;
    controls.addEventListener('start', () => { userInteracting = true; });
    controls.addEventListener('end', () => {
      userInteracting = false;
      lastInteractTime = performance.now();
    });

    // Holographic material
    const holoMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x00d4aa) },
        uSpeaking: { value: 0.0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying float vVertY;
        uniform float uTime;
        uniform float uSpeaking;

        void main() {
          vNormal = normalize(normalMatrix * normal);
          vVertY = position.y;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;

          // Breathing — gentle pulse
          float breath = sin(uTime * 1.5) * 0.01;

          // Body wave ripple — speed & amplitude increase when speaking
          float waveSpeed = 2.0 + uSpeaking * 3.0;
          float waveAmp = 0.004 + uSpeaking * 0.008;
          float wave = sin(position.x * 3.0 + uTime * waveSpeed)
                     * cos(position.z * 3.0 + uTime * waveSpeed * 0.85)
                     * waveAmp;

          // Limb-like movement: vertices far from center move more
          float distFromCenter = length(position.xz);
          float limbSway = distFromCenter * sin(uTime * 1.2 + position.x * 2.0) * 0.006;
          // Slightly different phase per "arm" direction
          limbSway += distFromCenter * cos(uTime * 1.0 + position.z * 2.0) * 0.004;

          vec3 pos = position + normal * (breath + wave);
          // Limb sway applies laterally, not along normal
          pos.x += sin(uTime * 1.2 + position.z * 1.5) * distFromCenter * 0.003;
          pos.z += cos(uTime * 1.0 + position.x * 1.5) * distFromCenter * 0.003;
          pos.y += limbSway * 0.5;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying float vVertY;
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uSpeaking;

        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = 1.0 - abs(dot(viewDir, vNormal));
          fresnel = pow(fresnel, 1.5);

          // Scan lines
          float scan = sin(vWorldPos.y * 60.0 + uTime * 3.0) * 0.5 + 0.5;
          scan = smoothstep(0.3, 0.7, scan) * 0.12;

          // Holographic shimmer bands
          float shimmer = sin(vVertY * 25.0 - uTime * 5.0) * 0.5 + 0.5;
          shimmer = pow(shimmer, 8.0) * 0.15;

          float intensity = 0.2 + fresnel * 0.5 + scan + shimmer;

          // Flicker
          intensity *= 0.94 + 0.06 * sin(uTime * 17.0 + vWorldPos.x * 8.0);

          vec3 col = uColor * intensity;

          float alpha = clamp(0.35 + fresnel * 0.5 + shimmer * 0.5, 0.0, 0.9);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const wireMaterial = new THREE.MeshBasicMaterial({
      color: 0x00d4aa,
      wireframe: true,
      transparent: true,
      opacity: 0.04,
    });

    let ring: THREE.Mesh | null = null;
    let particles: THREE.Points | null = null;
    let rockyPivot: THREE.Group | null = null;
    let modelSize = new THREE.Vector3();

    // Load Rocky
    const loader = new GLTFLoader();
    loader.load(
      '/rocky.glb',
      (gltf) => {
        const innerGroup = new THREE.Group();
        gltf.scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            if (!mesh.geometry.attributes.normal) {
              mesh.geometry.computeVertexNormals();
            }
            mesh.updateWorldMatrix(true, false);

            const holoMesh = new THREE.Mesh(mesh.geometry.clone(), holoMaterial);
            holoMesh.geometry.applyMatrix4(mesh.matrixWorld);
            innerGroup.add(holoMesh);

            const wire = new THREE.Mesh(mesh.geometry.clone(), wireMaterial);
            wire.geometry.applyMatrix4(mesh.matrixWorld);
            innerGroup.add(wire);
          }
        });

        // Auto-fit
        const box = new THREE.Box3().setFromObject(innerGroup);
        const center = new THREE.Vector3();
        box.getSize(modelSize);
        box.getCenter(center);
        innerGroup.position.set(-center.x, -center.y, -center.z);

        rockyPivot = new THREE.Group();
        rockyPivot.add(innerGroup);
        scene.add(rockyPivot);

        // Camera — closer on mobile for bigger Rocky
        const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z);
        const fov = camera.fov * (Math.PI / 180);
        const isMobile = width < 600;
        const distMult = isMobile ? 1.05 : 1.25;
        const dist = (maxDim / 2) / Math.tan(fov / 2) * distMult;
        camera.position.set(0, modelSize.y * 0.1, dist);
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
        controls.update();

        // Ring
        const ringR = Math.max(modelSize.x, modelSize.z) * 0.55;
        const ringGeo = new THREE.TorusGeometry(ringR, ringR * 0.012, 8, 64);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x00d4aa, transparent: true, opacity: 0.3,
        });
        ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -modelSize.y * 0.5;
        scene.add(ring);

        // Second ring (outer, dimmer)
        const ring2Geo = new THREE.TorusGeometry(ringR * 1.3, ringR * 0.006, 8, 64);
        const ring2Mat = new THREE.MeshBasicMaterial({
          color: 0x00d4aa, transparent: true, opacity: 0.12,
        });
        const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
        ring2.rotation.x = -Math.PI / 2;
        ring2.position.y = -modelSize.y * 0.5;
        scene.add(ring2);

        // Particles
        const pCount = 60;
        const pGeo = new THREE.BufferGeometry();
        const pPos = new Float32Array(pCount * 3);
        const pSpeeds = new Float32Array(pCount);
        for (let i = 0; i < pCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const r = ringR * (0.6 + Math.random() * 0.9);
          pPos[i * 3] = Math.cos(angle) * r;
          pPos[i * 3 + 1] = (Math.random() - 0.5) * modelSize.y * 1.4;
          pPos[i * 3 + 2] = Math.sin(angle) * r;
          pSpeeds[i] = 0.3 + Math.random() * 0.7;
        }
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        pGeo.setAttribute('speed', new THREE.BufferAttribute(pSpeeds, 1));
        const pMat = new THREE.PointsMaterial({
          color: 0x00d4aa,
          size: maxDim * 0.018,
          transparent: true,
          opacity: 0.4,
          sizeAttenuation: true,
        });
        particles = new THREE.Points(pGeo, pMat);
        scene.add(particles);
      },
      undefined,
      (err) => console.error('[Rocky] Load error:', err)
    );

    // Animation
    let animId: number;
    const startTime = performance.now();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const t = (performance.now() - startTime) / 1000;

      holoMaterial.uniforms.uTime.value = t;

      // Smooth speaking transition
      const targetSpeak = speakingRef.current ? 1.0 : 0.0;
      const cur = holoMaterial.uniforms.uSpeaking.value;
      holoMaterial.uniforms.uSpeaking.value += (targetSpeak - cur) * 0.06;

      // Rocky faces you — like a video call
      if (rockyPivot) {
        // Floating bob — visible hovering effect
        rockyPivot.position.y = Math.sin(t * 0.6) * modelSize.y * 0.03
                              + Math.sin(t * 1.1) * modelSize.y * 0.008;

        // Living micro-movements: weight shifting, breathing tilt
        const idleTiltX = Math.sin(t * 0.35) * 0.03 + Math.sin(t * 0.83) * 0.015;
        const idleTiltZ = Math.cos(t * 0.28) * 0.025 + Math.cos(t * 0.67) * 0.012;
        // Occasional bigger shift (like adjusting posture) every ~6 seconds
        const shiftCycle = t * 0.17;
        const postureShift = Math.sin(shiftCycle) * Math.sin(shiftCycle * 3.7) * 0.04;

        rockyPivot.rotation.x = idleTiltX;
        rockyPivot.rotation.z = idleTiltZ + postureShift;

        // Pause auto-rotate while user is dragging, resume after 3s
        if (userInteracting) {
          controls.autoRotate = false;
        } else if (lastInteractTime > 0) {
          const elapsed = (performance.now() - lastInteractTime) / 1000;
          if (elapsed > 3) {
            controls.autoRotate = true;
          }
        }
      }

      if (particles) {
        const pos = particles.geometry.attributes.position;
        const speeds = particles.geometry.attributes.speed;
        for (let i = 0; i < pos.count; i++) {
          let y = pos.getY(i);
          y += (speeds as THREE.BufferAttribute).getX(i) * 0.002;
          if (y > modelSize.y * 0.7) y = -modelSize.y * 0.7;
          pos.setY(i, y);
        }
        pos.needsUpdate = true;
        particles.rotation.y = t * 0.04;
      }

      if (ring) {
        ring.rotation.z = t * 0.1;
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div className="rocky-model-container" ref={containerRef}>
      <div className="screen-scanlines" />
      <div className="screen-signal">
        <span className="signal-dot" />
        HOLOGRAM — ERID SURFACE
      </div>
      <div className="screen-vignette" />
    </div>
  );
}
