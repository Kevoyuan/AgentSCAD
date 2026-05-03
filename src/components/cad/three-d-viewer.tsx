'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Box, Loader2, AlertCircle } from 'lucide-react'
import { Job, parseJSON, safeNum } from './types'
import { ViewerControls, useViewerControls } from './viewer-controls'

// ─── Rounded Rectangle Shape ──────────────────────────────────────────────────

function createRoundedRectShape(THREE: any, w: number, h: number, r: number) {
  const shape = new THREE.Shape()
  const hw = w / 2
  const hh = h / 2
  r = Math.min(r, hw, hh)

  shape.moveTo(-hw + r, -hh)
  shape.lineTo(hw - r, -hh)
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r)
  shape.lineTo(hw, hh - r)
  shape.quadraticCurveTo(hw, hh, hw - r, hh)
  shape.lineTo(-hw + r, hh)
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r)
  shape.lineTo(-hw, -hh + r)
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh)

  return shape
}

// ─── Auto-fit camera to geometry bounds ──────────────────────────────────────

function fitCameraToObject(THREE: any, camera: any, controls: any, object: any, padding = 1.4) {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(maxDim) || maxDim <= 0) {
    camera.position.set(60, 50, 60)
    controls.target.set(0, 0, 0)
    controls.update()
    return { center: new THREE.Vector3(0, 0, 0), size: new THREE.Vector3(1, 1, 1), maxDim: 1, dist: 90 }
  }
  const fov = camera.fov * (Math.PI / 180)
  const dist = (maxDim / 2 / Math.tan(fov / 2)) * padding

  camera.position.set(center.x + dist * 0.7, center.y + dist * 0.5, center.z + dist * 0.7)
  camera.near = Math.max(0.01, dist / 1000)
  camera.far = Math.max(1000, dist * 8, maxDim * 10)
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.update()
  return { center, size, maxDim, dist }
}

// ─── Fallback procedural enclosure ──────────────────────────────────────────

function buildProceduralEnclosure(THREE: any, mainGroup: any, values: Record<string, number>, controlsState: any) {
  const width = safeNum(values.width, 40)
  const depth = safeNum(values.depth, 30)
  const height = safeNum(values.height, 15)
  const wall = safeNum(values.wall_thickness, 2)
  const cornerR = Math.min(width, depth, height) * 0.12

  const outerShape = createRoundedRectShape(THREE, width, depth, cornerR)
  const outerGeo = new THREE.ExtrudeGeometry(outerShape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: 0.5,
    bevelSize: 0.5,
    bevelSegments: 2,
  })
  const outerMat = new THREE.MeshPhongMaterial({
    color: 0x4aa3ff,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    wireframe: controlsState.wireframe,
    shininess: 60,
  })
  const outerMesh = new THREE.Mesh(outerGeo, outerMat)
  outerMesh.rotation.x = -Math.PI / 2
  outerMesh.position.y = height
  mainGroup.add(outerMesh)

  const innerW = Math.max(0.1, width - 2 * wall)
  const innerD = Math.max(0.1, depth - 2 * wall)
  const innerH = Math.max(0.1, height - 2 * wall)
  const innerR = Math.max(0.1, cornerR - wall)
  const innerShape = createRoundedRectShape(THREE, innerW, innerD, innerR)
  const innerGeo = new THREE.ExtrudeGeometry(innerShape, { depth: innerH, bevelEnabled: false })
  const innerMat = new THREE.MeshPhongMaterial({
    color: 0x22d3ee,
    transparent: true,
    opacity: 0.08,
    side: THREE.BackSide,
    wireframe: controlsState.wireframe,
  })
  const innerMesh = new THREE.Mesh(innerGeo, innerMat)
  innerMesh.rotation.x = -Math.PI / 2
  innerMesh.position.y = height - wall
  mainGroup.add(innerMesh)

  const outerEdges = new THREE.EdgesGeometry(outerGeo, 15)
  const outerLine = new THREE.LineSegments(outerEdges, new THREE.LineBasicMaterial({ color: 0x9ccfff, transparent: true, opacity: 0.5 }))
  outerLine.rotation.x = -Math.PI / 2
  outerLine.position.y = height
  mainGroup.add(outerLine)
}

function buildProceduralGear(THREE: any, mainGroup: any, values: Record<string, number>, controlsState: any) {
  const teeth = Math.max(8, Math.round(safeNum(values.teeth, 24)))
  const outerDiameter = safeNum(values.outer_diameter, safeNum(values.diameter, 48))
  const boreDiameter = safeNum(values.bore_diameter, safeNum(values.bore, 8))
  const thickness = safeNum(values.thickness, safeNum(values.face_width, 8))
  const rootRadius = Math.max(outerDiameter * 0.32, outerDiameter / 2 - Math.max(2, outerDiameter * 0.08))
  const toothDepth = Math.max(1.2, outerDiameter / 2 - rootRadius)
  const mat = new THREE.MeshPhongMaterial({
    color: 0x4aa3ff,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    wireframe: controlsState.wireframe,
    shininess: 85,
  })

  const bodyGeo = new THREE.CylinderGeometry(rootRadius, rootRadius, thickness, Math.max(48, teeth * 3))
  const body = new THREE.Mesh(bodyGeo, mat)
  body.castShadow = true
  body.receiveShadow = true
  mainGroup.add(body)

  const toothWidth = Math.max(1.2, (Math.PI * rootRadius * 2) / teeth * 0.55)
  const toothGeo = new THREE.BoxGeometry(toothWidth, thickness, toothDepth)
  for (let i = 0; i < teeth; i += 1) {
    const angle = (i / teeth) * Math.PI * 2
    const tooth = new THREE.Mesh(toothGeo, mat.clone())
    tooth.position.set(
      Math.sin(angle) * (rootRadius + toothDepth / 2),
      0,
      Math.cos(angle) * (rootRadius + toothDepth / 2)
    )
    tooth.rotation.y = angle
    tooth.castShadow = true
    tooth.receiveShadow = true
    mainGroup.add(tooth)
  }

  const boreGeo = new THREE.CylinderGeometry(Math.max(0.8, boreDiameter / 2), Math.max(0.8, boreDiameter / 2), thickness + 0.2, 48)
  const boreMat = new THREE.MeshPhongMaterial({
    color: 0x080b10,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
  })
  const bore = new THREE.Mesh(boreGeo, boreMat)
  mainGroup.add(bore)

  const edges = new THREE.EdgesGeometry(bodyGeo, 20)
  const edgeLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x9ccfff, transparent: true, opacity: 0.35 }))
  mainGroup.add(edgeLines)
}

function buildProceduralPreview(THREE: any, mainGroup: any, values: Record<string, number>, partFamily: string, controlsState: any) {
  if (partFamily === 'spur_gear') {
    buildProceduralGear(THREE, mainGroup, values, controlsState)
    return
  }

  buildProceduralEnclosure(THREE, mainGroup, values, controlsState)
}

// ─── Bounding box dimension overlay ──────────────────────────────────────────

function createDimensionOverlay(THREE: any, mainGroup: any) {
  const box = new THREE.Box3().setFromObject(mainGroup)
  const size = box.getSize(new THREE.Vector3())
  const min = box.min
  const max = box.max

  // Bounding box wireframe
  const bboxGeo = new THREE.BoxGeometry(size.x, size.y, size.z)
  const bboxCenter = box.getCenter(new THREE.Vector3())
  const bboxEdges = new THREE.EdgesGeometry(bboxGeo)
  const bboxLine = new THREE.LineSegments(
    bboxEdges,
    new THREE.LineBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.35 })
  )
  bboxLine.position.copy(bboxCenter)

  // Origin axis arrows (small XYZ indicator)
  const axisGroup = new THREE.Group()
  const arrowLen = Math.max(size.x, size.y, size.z) * 0.15
  const arrowHeadLen = arrowLen * 0.2
  const arrowHeadWidth = arrowLen * 0.08

  const xArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0),
    arrowLen, 0xef4444, arrowHeadLen, arrowHeadWidth
  )
  const yArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0),
    arrowLen, 0x22c55e, arrowHeadLen, arrowHeadWidth
  )
  const zArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0),
    arrowLen, 0x3b82f6, arrowHeadLen, arrowHeadWidth
  )
  axisGroup.add(xArrow, yArrow, zArrow)

  // Dimension lines along each axis
  const dimMat = new THREE.LineBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.6 })
  const offset = Math.max(size.x, size.y, size.z) * 0.08

  // Width line (along X, at bottom-front)
  const wLine = createDimLine(THREE, dimMat,
    new THREE.Vector3(min.x, min.y - offset, max.z + offset),
    new THREE.Vector3(max.x, min.y - offset, max.z + offset)
  )
  // Depth line (along Z, at bottom-right)
  const dLine = createDimLine(THREE, dimMat,
    new THREE.Vector3(max.x + offset, min.y - offset, min.z),
    new THREE.Vector3(max.x + offset, min.y - offset, max.z)
  )
  // Height line (along Y, at back-right)
  const hLine = createDimLine(THREE, dimMat,
    new THREE.Vector3(max.x + offset, min.y, max.z + offset),
    new THREE.Vector3(max.x + offset, max.y, max.z + offset)
  )

  const dimGroup = new THREE.Group()
  dimGroup.add(wLine, dLine, hLine)

  return {
    bboxLine,
    axisGroup,
    dimGroup,
    sizes: {
      w: size.x.toFixed(1),
      d: size.z.toFixed(1),
      h: size.y.toFixed(1),
    },
    positions: {
      w: new THREE.Vector3(bboxCenter.x, min.y - offset * 1.8, max.z + offset),
      d: new THREE.Vector3(max.x + offset, min.y - offset * 1.8, bboxCenter.z),
      h: new THREE.Vector3(max.x + offset * 1.5, bboxCenter.y, max.z + offset),
    },
  }
}

function createDimLine(THREE: any, mat: any, start: any, end: any) {
  const geo = new THREE.BufferGeometry().setFromPoints([start, end])
  return new THREE.Line(geo, mat)
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ThreeDViewer({ job }: { job: Job }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    state: controlsState,
    setState: setControlsState,
  } = useViewerControls({
    autoRotate: true,
    wireframe: false,
    showGrid: true,
    showAxes: true,
    darkBg: true,
    showDimensions: true,
  })

  const threeModuleRef = useRef<any>(null)
  const sceneRef = useRef<any>(null)
  const controlsObjRef = useRef<any>(null)
  const gridHelperRef = useRef<any>(null)
  const axisHelperRef = useRef<any>(null)
  const cameraRef = useRef<any>(null)
  const rendererRef = useRef<any>(null)
  const mainGroupRef = useRef<any>(null)
  const bboxOverlayRef = useRef<any>(null)
  const dimensionLabelsRef = useRef<{ w: string; d: string; h: string }>({ w: '', d: '', h: '' })

  const values = parseJSON<Record<string, number>>(job.parameterValues, {})
  const partFamily = job.partFamily || 'unknown'
  const geometryKey = job.stlPath
    ? `${job.stlPath}:${job.updatedAt || ''}`
    : `${job.state}:${job.parameterValues || ''}:${partFamily}`
  const dimensionSummary = (() => {
    const width = values.width ?? values.phone_width ?? values.outer_diameter ?? values.diameter
    const depth = values.depth ?? values.phone_length ?? values.thickness
    const height = values.height ?? values.phone_thickness
    const dims = [width, depth, height].filter(v => typeof v === 'number')
    return dims.length ? dims.map(v => Number(v).toFixed(Number(v) % 1 === 0 ? 0 : 1)).join(' x ') : ''
  })()
  const dimLabels = dimensionLabelsRef.current

  // Apply controls state changes to Three.js scene
  useEffect(() => {
    if (controlsObjRef.current) {
      controlsObjRef.current.autoRotate = controlsState.autoRotate
    }
    if (mainGroupRef.current) {
      mainGroupRef.current.traverse((child: any) => {
        if (child.isMesh && child.material) {
          child.material.wireframe = controlsState.wireframe
        }
      })
    }
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = controlsState.showGrid
    }
    if (axisHelperRef.current) {
      axisHelperRef.current.visible = controlsState.showAxes
    }
    if (bboxOverlayRef.current) {
      bboxOverlayRef.current.bboxLine.visible = controlsState.showDimensions
      bboxOverlayRef.current.axisGroup.visible = controlsState.showDimensions
      bboxOverlayRef.current.dimGroup.visible = controlsState.showDimensions
    }
    if (sceneRef.current && threeModuleRef.current) {
      sceneRef.current.background = new threeModuleRef.current.Color(
        controlsState.darkBg ? 0x080b10 : 0x111827
      )
    }
  }, [controlsState])

  const handleResetCamera = useCallback(() => {
    if (cameraRef.current && controlsObjRef.current && mainGroupRef.current && threeModuleRef.current) {
      fitCameraToObject(threeModuleRef.current, cameraRef.current, controlsObjRef.current, mainGroupRef.current)
    }
  }, [])

  const handleZoomIn = useCallback(() => {
    if (cameraRef.current) {
      cameraRef.current.position.multiplyScalar(0.85)
      if (controlsObjRef.current) controlsObjRef.current.update()
    }
  }, [])

  const handleZoomOut = useCallback(() => {
    if (cameraRef.current) {
      cameraRef.current.position.multiplyScalar(1.15)
      if (controlsObjRef.current) controlsObjRef.current.update()
    }
  }, [])

  const handleScreenshotWithCanvas = useCallback(() => {
    if (rendererRef.current) {
      const canvas = rendererRef.current.domElement
      if (canvas) {
        const link = document.createElement('a')
        link.download = `cad-preview-${Date.now()}.png`
        link.href = canvas.toDataURL('image/png')
        link.click()
      }
    }
  }, [])

  useEffect(() => {
    if (!mountRef.current || job.state === 'NEW' || job.state === 'SCAD_GENERATED') return

    let cancelled = false
    setIsLoading(true)
    setError(null)

    const container = mountRef.current
    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) {
      setIsLoading(false)
      return
    }

    let renderer: any = null
    let controls: any = null
    let animFrameId: number | null = null

    Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js'),
    ]).then(async ([THREE, { OrbitControls }]) => {
      threeModuleRef.current = THREE

      if (cancelled || !mountRef.current) return

      try {
        const scene = new THREE.Scene()
        scene.background = new THREE.Color(controlsState.darkBg ? 0x080b10 : 0x111827)
        scene.fog = new THREE.Fog(0x080b10, 600, 1200)
        sceneRef.current = scene

        const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000)
        camera.position.set(60, 50, 60)
        cameraRef.current = camera

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
        renderer.setSize(w, h)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.shadowMap.enabled = true
        rendererRef.current = renderer

        while (container.firstChild) {
          container.removeChild(container.firstChild)
        }
        container.appendChild(renderer.domElement)

        controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.05
        controls.autoRotate = controlsState.autoRotate
        controls.autoRotateSpeed = 0.5
        controlsObjRef.current = controls

        const gridHelper = new THREE.GridHelper(120, 24, 0x24435f, 0x152434)
        gridHelper.visible = controlsState.showGrid
        scene.add(gridHelper)
        gridHelperRef.current = gridHelper

        const axisHelper = new THREE.AxesHelper(30)
        axisHelper.position.set(-50, 0.1, -50)
        axisHelper.visible = controlsState.showAxes
        scene.add(axisHelper)
        axisHelperRef.current = axisHelper

        const mainGroup = new THREE.Group()

        // ─── Load real STL if available, otherwise fall back to procedural mesh ───
        if (job.stlPath) {
          try {
            const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
            const loader = new STLLoader()
            const cacheKey = encodeURIComponent(job.updatedAt || job.parameterValues || '')
            const stlUrl = `${job.stlPath}${job.stlPath.includes('?') ? '&' : '?'}v=${cacheKey}`

            const geometry = await new Promise<any>((resolve, reject) => {
              loader.load(
                stlUrl,
                (geo: any) => resolve(geo),
                undefined,
                (err: any) => reject(err),
              )
            })

            if (cancelled) return

            // Center geometry around the origin so camera fitting works across STL generators.
            geometry.computeBoundingBox()
            const bbox = geometry.boundingBox
            if (!bbox || bbox.isEmpty()) {
              throw new Error('STL has no renderable geometry')
            }
            const center = new THREE.Vector3()
            bbox.getCenter(center)
            geometry.translate(-center.x, -center.y, -center.z)
            geometry.computeVertexNormals()

            const material = new THREE.MeshPhongMaterial({
              color: 0x4aa3ff,
              transparent: true,
              opacity: 0.85,
              side: THREE.DoubleSide,
              wireframe: controlsState.wireframe,
              shininess: 80,
            })

            const mesh = new THREE.Mesh(geometry, material)
            mesh.castShadow = true
            mesh.receiveShadow = true
            mainGroup.add(mesh)

            // Wireframe overlay
            const edges = new THREE.EdgesGeometry(geometry, 30)
            const edgeMat = new THREE.LineBasicMaterial({ color: 0x9ccfff, transparent: true, opacity: 0.4 })
            const edgeLines = new THREE.LineSegments(edges, edgeMat)
            mainGroup.add(edgeLines)

          } catch (stlErr) {
            console.warn('STL load failed, using procedural fallback:', stlErr)
            buildProceduralPreview(THREE, mainGroup, values, partFamily, controlsState)
          }
        } else {
          buildProceduralPreview(THREE, mainGroup, values, partFamily, controlsState)
        }

        scene.add(mainGroup)
        mainGroupRef.current = mainGroup

        // Add dimension overlay (bounding box + axis + dim lines)
        const dimOverlay = createDimensionOverlay(THREE, mainGroup)
        dimOverlay.bboxLine.visible = controlsState.showDimensions
        dimOverlay.axisGroup.visible = controlsState.showDimensions
        dimOverlay.dimGroup.visible = controlsState.showDimensions
        scene.add(dimOverlay.bboxLine)
        scene.add(dimOverlay.axisGroup)
        scene.add(dimOverlay.dimGroup)
        bboxOverlayRef.current = dimOverlay
        dimensionLabelsRef.current = dimOverlay.sizes

        // Auto-fit camera to the loaded geometry. Fog must scale with the fitted
        // distance, otherwise long phone-case models disappear into the background.
        const fitted = fitCameraToObject(THREE, camera, controls, mainGroup)
        scene.fog = new THREE.Fog(
          0x080b10,
          Math.max(fitted.dist * 1.6, fitted.maxDim * 2.2, 220),
          Math.max(fitted.dist * 5.5, fitted.maxDim * 8, 900),
        )

        // Lights
        const ambient = new THREE.AmbientLight(0x404060, 2.5)
        scene.add(ambient)
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
        dirLight.position.set(50, 80, 50)
        dirLight.castShadow = true
        scene.add(dirLight)
        const pointLight1 = new THREE.PointLight(0x4aa3ff, 0.55, 200)
        pointLight1.position.set(-30, 40, -30)
        scene.add(pointLight1)
        const pointLight2 = new THREE.PointLight(0x22d3ee, 0.3, 150)
        pointLight2.position.set(30, 20, 30)
        scene.add(pointLight2)

        setIsLoading(false)

        function animate() {
          if (cancelled) return
          animFrameId = requestAnimationFrame(animate)
          controls.update()
          renderer.render(scene, camera)
        }
        animate()

      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '3D rendering failed')
          setIsLoading(false)
        }
      }
    }).catch(() => {
      if (!cancelled) {
        setError('Failed to load 3D library')
        setIsLoading(false)
      }
    })

    return () => {
      cancelled = true
      if (animFrameId !== null) cancelAnimationFrame(animFrameId)
      if (renderer) {
        renderer.dispose()
        renderer = null
      }
      if (controls) {
        controls.dispose()
        controls = null
      }
      threeModuleRef.current = null
      sceneRef.current = null
      controlsObjRef.current = null
      gridHelperRef.current = null
      axisHelperRef.current = null
      cameraRef.current = null
      rendererRef.current = null
      mainGroupRef.current = null
      if (container) {
        while (container.firstChild) {
          container.removeChild(container.firstChild)
        }
      }
    }
  }, [geometryKey, controlsState.darkBg, controlsState.showAxes, controlsState.showDimensions, controlsState.showGrid, controlsState.wireframe])

  if (job.state === 'NEW' || job.state === 'SCAD_GENERATED') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--app-text-dim)] gap-3">
        <div className="w-16 h-16 rounded-2xl bg-[var(--app-empty-bg)] flex items-center justify-center">
          <Box className="w-8 h-7 opacity-20" />
        </div>
        <span className="text-xs">Process job to generate 3D preview</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-3 overflow-hidden bg-[var(--app-bg)] p-4 text-[var(--app-text-dim)]">
        {job.pngPath ? (
          <>
            <img
              src={job.pngPath}
              alt="Rendered CAD preview"
              className="max-h-full max-w-full object-contain"
            />
            <div className="absolute left-3 top-3 rounded border border-[color:var(--app-border)] bg-[var(--app-surface)] px-2 py-1 text-[11px] text-[var(--app-text-muted)] shadow-sm">
              WebGL unavailable. Showing rendered PNG preview.
            </div>
          </>
        ) : (
          <>
            <AlertCircle className="w-8 h-7 text-rose-500/50" />
            <span className="text-xs text-rose-400">3D preview unavailable</span>
            <span className="text-[13px] text-[var(--app-text-dim)]">{error}</span>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="relative w-full h-full cad-viewport-shell overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 w-3/4 max-w-xs">
            <div className="skeleton-loading w-full h-40 rounded-lg" />
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--app-accent-text)]" />
              <span className="text-[13px] text-[var(--app-text-muted)]">Loading 3D preview...</span>
            </div>
          </div>
        </div>
      )}
      <div ref={mountRef} className="w-full h-full" />
      <div className="absolute top-2 left-2 flex items-center gap-2 z-[5]">
        <span className="cad-chip bg-black/35 text-[var(--cad-text-secondary)]">
          {partFamily}
          {job.stlPath ? ' (STL)' : ' (preview)'}
        </span>
        <span className="hidden md:inline-flex cad-chip bg-black/35 text-[var(--cad-text-muted)]">mm units</span>
      </div>
      <div className="absolute top-2 right-3 z-[5] pointer-events-none">
        <span className="text-[8px] font-mono text-[var(--cad-text-muted)] tracking-widest cad-viewport-glass rounded px-2 py-1">ORTHO / GRID</span>
      </div>
      {dimensionSummary && (
        <div className="absolute top-9 right-3 z-[5] pointer-events-none">
          <span className="text-[8px] font-mono text-[var(--cad-measure)] tracking-widest cad-viewport-glass rounded px-2 py-1">{dimensionSummary} mm</span>
        </div>
      )}
      {controlsState.showDimensions && dimLabels.w && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[5] pointer-events-none flex items-center gap-3">
          <span className="text-xs font-mono text-[var(--cad-measure)] cad-viewport-glass rounded px-1.5 py-0.5">W {dimLabels.w}</span>
          <span className="text-xs font-mono text-[var(--cad-measure)] cad-viewport-glass rounded px-1.5 py-0.5">D {dimLabels.d}</span>
          <span className="text-xs font-mono text-[var(--cad-measure)] cad-viewport-glass rounded px-1.5 py-0.5">H {dimLabels.h}</span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 z-[5] pointer-events-none">
        <span className="text-[8px] font-mono text-[var(--cad-text-muted)] tracking-widest cad-viewport-glass rounded px-2 py-1">AgentSCAD CAD Preview</span>
      </div>
      <ViewerControls
        state={controlsState}
        onChange={setControlsState}
        onResetCamera={handleResetCamera}
        onScreenshot={handleScreenshotWithCanvas}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
      />
    </div>
  )
}
