'use client'

import * as React from 'react'
import { useI18n } from '@/components/i18n-provider'
import type { Object3D, BufferGeometry, MeshStandardMaterial, SphereGeometry, MeshBasicMaterial } from 'three'
import type { CollisionReplayPair } from './collision-replay-data'

/**
 * The canvas holds the *two* exact STL meshes from an authenticated source/spec
 * bundle at the measured BVH world matrices. It is NOT the general single-job
 * STL viewport, a boolean-unioned assembly or a swept-motion simulation.
 */
export function CollisionPairViewer({ pair }: { pair: CollisionReplayPair }) {
  const { t } = useI18n()
  const mount = React.useRef<HTMLDivElement>(null)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let disposed = false
    let cleanup = () => {}
    setError('')
    const setup = async () => {
      const [THREE, { STLLoader }, { OrbitControls }] = await Promise.all([
        import('three'),
        import('three/examples/jsm/loaders/STLLoader.js'),
        import('three/examples/jsm/controls/OrbitControls.js'),
      ])
      if (disposed || !mount.current) return
      const host = mount.current
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setClearColor(0x171b22, 1)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      host.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x171b22)
      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000)
      camera.up.set(0, 0, 1) // OpenSCAD/STL assembly coordinates are Z-up, in millimetres.
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.enablePan = true
      scene.add(new THREE.AmbientLight(0xffffff, 1.1))
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
      keyLight.position.set(25, -20, 40)
      scene.add(keyLight)

      const loader = new STLLoader()
      const objects: Object3D[] = []
      const resources: Array<{ geometry: BufferGeometry; material: MeshStandardMaterial }> = []
      const addMesh = (entry: CollisionReplayPair['moving'], color: number) => {
        // STLLoader.parse expects ArrayBuffer; an owned copy also avoids view offsets.
        const bytes = new Uint8Array(entry.stl.length)
        bytes.set(entry.stl)
        const geometry = loader.parse(bytes.buffer)
        const material = new THREE.MeshStandardMaterial({
          color, roughness: 0.65, metalness: 0.08,
          transparent: true, opacity: 0.88, side: THREE.DoubleSide,
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.matrixAutoUpdate = false
        // THREE.Matrix4.set takes row-major entries, exactly the BVH convention.
        mesh.matrix.set(
          entry.matrix[0], entry.matrix[1], entry.matrix[2], entry.matrix[3],
          entry.matrix[4], entry.matrix[5], entry.matrix[6], entry.matrix[7],
          entry.matrix[8], entry.matrix[9], entry.matrix[10], entry.matrix[11],
          entry.matrix[12], entry.matrix[13], entry.matrix[14], entry.matrix[15],
        )
        scene.add(mesh)
        objects.push(mesh)
        resources.push({ geometry, material })
      }
      addMesh(pair.moving, 0x48a5eb)
      addMesh(pair.obstacle, 0xffb45c)

      const bounds = new THREE.Box3()
      for (const object of objects) bounds.expandByObject(object)
      const center = bounds.getCenter(new THREE.Vector3())
      const span = Math.max(bounds.getSize(new THREE.Vector3()).length(), 2)
      const focus = pair.witnessCentroidPointMm
        ? new THREE.Vector3(...pair.witnessCentroidPointMm)
        : center
      // An INTERSECT witness is a midpoint of triangle centroids, not an exact
      // point of contact. UNKNOWN and CONTAINED never receive a fake marker.
      let witnessGeometry: SphereGeometry | null = null
      let witnessMaterial: MeshBasicMaterial | null = null
      if (pair.collision === 'INTERSECT' && pair.witnessCentroidPointMm) {
        witnessGeometry = new THREE.SphereGeometry(Math.max(0.08, span * 0.009), 16, 12)
        witnessMaterial = new THREE.MeshBasicMaterial({ color: 0xfc437a, depthTest: false })
        const marker = new THREE.Mesh(witnessGeometry, witnessMaterial)
        marker.position.copy(focus)
        marker.renderOrder = 10
        scene.add(marker)
      }
      scene.add(new THREE.AxesHelper(Math.max(3, span * 0.1)))
      camera.near = Math.max(0.001, span / 5000)
      camera.far = Math.max(1000, span * 30)
      camera.position.copy(focus).add(new THREE.Vector3(span * 0.82, -span * 0.82, span * 0.65))
      camera.updateProjectionMatrix()
      controls.target.copy(focus)
      controls.update()

      const resize = () => {
        const width = Math.max(1, host.clientWidth)
        const height = Math.max(1, host.clientHeight)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        renderer.setSize(width, height, false)
      }
      const observer = new ResizeObserver(resize)
      observer.observe(host)
      resize()

      let frame = 0
      const animate = () => {
        if (disposed) return
        controls.update()
        renderer.render(scene, camera)
        frame = requestAnimationFrame(animate)
      }
      animate()
      cleanup = () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        controls.dispose()
        for (const { geometry, material } of resources) { geometry.dispose(); material.dispose() }
        witnessGeometry?.dispose()
        witnessMaterial?.dispose()
        renderer.dispose()
        renderer.domElement.remove()
      }
    }
    void setup().catch(error => {
      if (!disposed) setError(error instanceof Error ? error.message : '3D replay unavailable.')
    })
    return () => { disposed = true; cleanup() }
  }, [pair])

  return <div className="mt-2">
    <p className="mb-1 font-medium">{t('Collision pair 3D replay')} — {pair.collision} · {t('Pose')} #{pair.poseIndex}</p>
    <p className="mb-1 text-[var(--shell-text-label)]">{t('Blue: moving part · Orange: obstacle · Pink: approximate triangle-centroid witness (when available).')}</p>
    <div ref={mount} className="relative h-[280px] w-full overflow-hidden rounded border border-[color:var(--shell-hairline)]" role="img" aria-label={t('3D replay of measured collision pair')} />
    {error && <p role="alert" className="mt-1 text-[var(--shell-fail)]">{t('3D replay unavailable')}: {error}</p>}
    <p className="mt-1 text-[var(--shell-text-label)]">{t('Drag to rotate, scroll to zoom. Only two sampled meshes are shown; no continuous clearance, physical fit or exact contact is established.')}</p>
  </div>
}
