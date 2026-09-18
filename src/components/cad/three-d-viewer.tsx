'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Box, AlertCircle } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Job, parseJSON, safeNum } from './types'
import { ViewerControls, useViewerControls } from './viewer-controls'
import { useTheme } from 'next-themes'

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

/**
 * Technical line colour for the part's edges, its bounding box and the dimension
 * lines. Deliberately NOT the brand signal: DESIGN.md section 11 gives the signal
 * colour to the action and the active state only, and section 4 says the part is
 * neutral machined grey. These were hardcoded amber (0xF59E0B), which made the
 * model read as an orange wireframe on top of the brand accent.
 */
const TECHNICAL_LINE = 0x93a1ae

/*
 * The field is painted by three.js, so it cannot inherit a CSS variable the way a
 * div does: the background, the fog and the grid were literals (#0B0F14, #141312,
 * #2B3643, #C9C3B8) that had already drifted from the token map. Read the shell's
 * own field tokens instead, so the largest surface in the product has one owner.
 */
function fieldToken(name: string, fallback: number): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return fallback
  return parseInt(raw.slice(1).length === 3
    ? raw.slice(1).split('').map(c => c + c).join('')
    : raw.slice(1), 16)
}

/*
 * The camera stops 0.2 degrees short of the poles: at exactly +/-90 the forward
 * axis is parallel to `up` and the view is undefined. OrbitControls' own polar
 * limits must be the mirror of that rule - they were not (maxPolarAngle was 0.96π,
 * i.e. -82.8 degrees of elevation), so asking for 下 left the camera 7 degrees
 * short and the cube honestly reported a free angle instead of the stop. Drag was
 * asymmetric in the same way: it could reach the top stop but never the bottom.
 */
const MAX_ELEVATION = 89.8
const POLAR_GUARD = ((90 - MAX_ELEVATION) * Math.PI) / 180

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
  controls.minDistance = Math.max(0.5, dist * 0.05, maxDim * 0.1)
  controls.maxDistance = Math.max(500, dist * 8, maxDim * 15)
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
    color: 0x9BA6B2,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    wireframe: controlsState.wireframe,
    shininess: 50,
  })
  const outerMesh = new THREE.Mesh(outerGeo, outerMat)
  outerMesh.rotation.x = -Math.PI / 2
  outerMesh.position.y = 0
  mainGroup.add(outerMesh)

  const innerW = Math.max(0.1, width - 2 * wall)
  const innerD = Math.max(0.1, depth - 2 * wall)
  const innerH = Math.max(0.1, height - 2 * wall)
  const innerR = Math.max(0.1, cornerR - wall)
  const innerShape = createRoundedRectShape(THREE, innerW, innerD, innerR)
  const innerGeo = new THREE.ExtrudeGeometry(innerShape, { depth: innerH, bevelEnabled: false })
  const innerMat = new THREE.MeshPhongMaterial({
    color: 0x77828E,
    transparent: true,
    opacity: 0.4,
    side: THREE.BackSide,
    wireframe: controlsState.wireframe,
  })
  const innerMesh = new THREE.Mesh(innerGeo, innerMat)
  innerMesh.rotation.x = -Math.PI / 2
  innerMesh.position.y = wall
  mainGroup.add(innerMesh)

  const outerEdges = new THREE.EdgesGeometry(outerGeo, 15)
  const outerLine = new THREE.LineSegments(outerEdges, new THREE.LineBasicMaterial({ color: TECHNICAL_LINE, transparent: true, opacity: 0.30 }))
  outerLine.rotation.x = -Math.PI / 2
  outerLine.position.y = 0
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
    color: 0x9BA6B2,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    wireframe: controlsState.wireframe,
    shininess: 55,
  })

  const bodyGeo = new THREE.CylinderGeometry(rootRadius, rootRadius, thickness, Math.max(48, teeth * 3))
  const body = new THREE.Mesh(bodyGeo, mat)
  body.position.y = thickness / 2
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
      thickness / 2,
      Math.cos(angle) * (rootRadius + toothDepth / 2)
    )
    tooth.rotation.y = angle
    tooth.castShadow = true
    tooth.receiveShadow = true
    mainGroup.add(tooth)
  }

  const boreGeo = new THREE.CylinderGeometry(Math.max(0.8, boreDiameter / 2), Math.max(0.8, boreDiameter / 2), thickness + 0.2, 48)
  const boreMat = new THREE.MeshPhongMaterial({
    color: 0x5D6772,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  })
  const bore = new THREE.Mesh(boreGeo, boreMat)
  bore.position.y = thickness / 2
  mainGroup.add(bore)

  const edges = new THREE.EdgesGeometry(bodyGeo, 20)
  const edgeLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: TECHNICAL_LINE, transparent: true, opacity: 0.26 }))
  edgeLines.position.y = thickness / 2
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

  // Bounding box wireframe (measurement layer, opt-in)
  const bboxGeo = new THREE.BoxGeometry(size.x, size.y, size.z)
  const bboxCenter = box.getCenter(new THREE.Vector3())
  const bboxEdges = new THREE.EdgesGeometry(bboxGeo)
  const bboxLine = new THREE.LineSegments(
    bboxEdges,
    new THREE.LineBasicMaterial({ color: TECHNICAL_LINE, transparent: true, opacity: 0.26 })
  )
  bboxLine.position.copy(bboxCenter)

  // Origin axis arrows: the universal XYZ convention (red / green / blue)
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
    arrowLen, 0x10b981, arrowHeadLen, arrowHeadWidth
  )
  const zArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0),
    arrowLen, 0x6e8ca8, arrowHeadLen, arrowHeadWidth
  )
  axisGroup.add(xArrow, yArrow, zArrow)

  // Dimension lines along each axis (measurement layer, opt-in)
  const dimMat = new THREE.LineBasicMaterial({ color: TECHNICAL_LINE, transparent: true, opacity: 0.5 })
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

export type ViewCommand = {
  /** degrees; 0 = front, +90 = right */
  azimuth: number
  /** degrees; +90 = looking straight down */
  elevation: number
  /** bumped by the caller so repeating the same view still applies */
  nonce: number
  /** bumped when the caller wants the part refitted to the viewport */
  fit?: number
}

export function ThreeDViewer({
  job,
  onDownloadStl,
  isDownloadingStl,
  hasStl,
  viewCommand,
  onViewChange,
}: {
  job: Job
  onDownloadStl?: () => void
  isDownloadingStl?: boolean
  hasStl?: boolean
  /* DESIGN.md section 4: the ViewCube and the viewport share one camera. The cube
     cannot own orientation, so the camera is commanded from outside. */
  viewCommand?: ViewCommand | null
  onViewChange?: (camera: { azimuth: number; elevation: number }) => void
}) {
  // DESIGN.md section 11: one semantic hierarchy in both themes. The viewport
  // field is part of the workspace, so it follows the theme rather than owning a
  // separate "dark background" preference.
  const { resolvedTheme } = useTheme()
  const fieldIsDark = (resolvedTheme ?? 'dark') !== 'light'

  const mountRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    state: controlsState,
    setState: setControlsState,
  } = useViewerControls({
    // DESIGN.md section 4: the part is inspected, not performed at. Auto-rotate
    // also makes the ViewCube's meaning drift, so it defaults off.
    autoRotate: false,
    wireframe: false,
    showGrid: true,
    showAxes: true,
    // DESIGN.md section 4: the default viewport is the part, a faint grid and an
    // orientation triad. Bounding box and dimension lines are a measurement layer
    // you switch on, not permanent furniture.
    showDimensions: false,
    darkBg: true,
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

  const lastNonceRef = useRef<number>(-1)
  const lastFitRef = useRef<number>(0)
  const reportRef = useRef(onViewChange)
  reportRef.current = onViewChange

  /* ViewCube -> camera: the cube only ever commands, it never owns orientation.
     Declared with the other hooks, above every early return. */
  useEffect(() => {
    if (!viewCommand) return

    // Fit is a separate request: the caller bumps `fit` without changing angles.
    if (viewCommand.fit !== undefined && viewCommand.fit !== lastFitRef.current) {
      lastFitRef.current = viewCommand.fit
      const THREE = threeModuleRef.current
      const camera = cameraRef.current
      const controls = controlsObjRef.current
      const object = mainGroupRef.current
      if (THREE && camera && controls && object) {
        fitCameraToObject(THREE, camera, controls, object)
        const target = controls.target
        const dx = camera.position.x - target.x
        const dy = camera.position.y - target.y
        const dz = camera.position.z - target.z
        const dist = Math.hypot(dx, dy, dz) || 1
        if (reportRef.current) {
          reportRef.current({
            azimuth: (Math.atan2(dx, dz) * 180) / Math.PI,
            elevation: (Math.asin(Math.max(-1, Math.min(1, dy / dist))) * 180) / Math.PI,
          })
        }
        controls.update?.()
        return
      }
    }

    if (viewCommand.nonce === lastNonceRef.current) return
    const THREE = threeModuleRef.current
    const camera = cameraRef.current
    const controls = controlsObjRef.current
    if (!THREE || !camera || !controls) return
    lastNonceRef.current = viewCommand.nonce

    const target = controls.target ?? new THREE.Vector3(0, 0, 0)
    const distance = camera.position.distanceTo(target) || 100
    const az = (viewCommand.azimuth * Math.PI) / 180
    const el = (Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, viewCommand.elevation)) * Math.PI) / 180
    camera.position.set(
      target.x + distance * Math.cos(el) * Math.sin(az),
      target.y + distance * Math.sin(el),
      target.z + distance * Math.cos(el) * Math.cos(az)
    )
    camera.up.set(0, 1, 0)
    camera.lookAt(target)
    controls.update?.()
  }, [viewCommand])


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
        fieldToken('--shell-canvas-deep', fieldIsDark ? 0x0E0D0C : 0xEDE9E1)
      )
    }
  }, [controlsState, fieldIsDark])

  const handleResetCamera = useCallback(() => {
    if (cameraRef.current && controlsObjRef.current && mainGroupRef.current && threeModuleRef.current) {
      fitCameraToObject(threeModuleRef.current, cameraRef.current, controlsObjRef.current, mainGroupRef.current)
    }
  }, [])

  const handleZoomIn = useCallback(() => {
    if (cameraRef.current && controlsObjRef.current) {
      const controls = controlsObjRef.current
      const camera = cameraRef.current
      const offset = camera.position.clone().sub(controls.target)
      offset.multiplyScalar(0.85)
      camera.position.copy(controls.target).add(offset)
      controls.update()
    }
  }, [])

  const handleZoomOut = useCallback(() => {
    if (cameraRef.current && controlsObjRef.current) {
      const controls = controlsObjRef.current
      const camera = cameraRef.current
      const offset = camera.position.clone().sub(controls.target)
      offset.multiplyScalar(1.15)
      camera.position.copy(controls.target).add(offset)
      controls.update()
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
        scene.background = new THREE.Color(fieldToken('--shell-canvas-deep', controlsState.darkBg ? 0x0E0D0C : 0xEDE9E1))
        scene.fog = new THREE.Fog(fieldToken('--shell-canvas-deep', controlsState.darkBg ? 0x0E0D0C : 0xEDE9E1), 600, 1200)
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
        controls.dampingFactor = 0.08
        controls.rotateSpeed = 0.8
        controls.zoomSpeed = 0.9
        controls.panSpeed = 0.8
        controls.screenSpacePanning = true
        controls.minPolarAngle = POLAR_GUARD
        controls.maxPolarAngle = Math.PI - POLAR_GUARD
        controls.autoRotate = controlsState.autoRotate
        controls.autoRotateSpeed = 0.5
        controlsObjRef.current = controls

        // Report the camera outward on every orbit so the ViewCube mirrors it.
        // The cube must never be able to disagree with what is on screen.
        controls.addEventListener('change', () => {
          const cam = cameraRef.current
          const target = controls.target
          if (!cam || !target || !reportRef.current) return
          const dx = cam.position.x - target.x
          const dy = cam.position.y - target.y
          const dz = cam.position.z - target.z
          const dist = Math.hypot(dx, dy, dz) || 1
          const elevation = (Math.asin(Math.max(-1, Math.min(1, dy / dist))) * 180) / Math.PI
          const azimuth = (Math.atan2(dx, dz) * 180) / Math.PI
          reportRef.current({ azimuth, elevation })
        })

        const gridHelper = new THREE.GridHelper(
          120,
          24,
          fieldToken('--shell-field-grid-strong', fieldIsDark ? 0x242322 : 0xD5D2CB),
          fieldToken('--shell-field-grid', fieldIsDark ? 0x191817 : 0xE0DCD5)
        )
        gridHelper.position.y = -0.01
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
        if (hasStl && job.stlPath) {
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

            // Center geometry horizontally and ground bottom to y = 0
            geometry.computeBoundingBox()
            const bbox = geometry.boundingBox
            if (!bbox || bbox.isEmpty()) {
              throw new Error('STL has no renderable geometry')
            }
            const center = new THREE.Vector3()
            bbox.getCenter(center)
            geometry.translate(-center.x, -bbox.min.y, -center.z)
            geometry.computeBoundingBox()
            geometry.computeVertexNormals()

            const material = new THREE.MeshPhongMaterial({
              color: 0x9BA6B2,
              transparent: true,
              opacity: 0.92,
              side: THREE.DoubleSide,
              wireframe: controlsState.wireframe,
              shininess: 55,
              specular: 0x222222,
            })

            const mesh = new THREE.Mesh(geometry, material)
            mesh.castShadow = true
            mesh.receiveShadow = true
            mainGroup.add(mesh)

            // Wireframe overlay (Warm Amber laser precision)
            const edges = new THREE.EdgesGeometry(geometry, 30)
            const edgeMat = new THREE.LineBasicMaterial({ color: TECHNICAL_LINE, transparent: true, opacity: 0.26 })
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

        // Defensive group-level alignment: guarantee bottom sits at y = 0
        mainGroup.updateMatrixWorld(true)
        const groupBbox = new THREE.Box3().setFromObject(mainGroup)
        if (!groupBbox.isEmpty()) {
          const groupCenter = groupBbox.getCenter(new THREE.Vector3())
          mainGroup.position.x -= groupCenter.x
          mainGroup.position.y -= groupBbox.min.y
          mainGroup.position.z -= groupCenter.z
          mainGroup.updateMatrixWorld(true)
        }

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
          fieldToken('--shell-canvas-deep', fieldIsDark ? 0x0E0D0C : 0xEDE9E1),
          Math.max(fitted.dist * 1.6, fitted.maxDim * 2.2, 220),
          Math.max(fitted.dist * 5.5, fitted.maxDim * 8, 900),
        )

        // Lights: calibrated neutral illumination without chromatic light pollution
        const ambient = new THREE.AmbientLight(0xffffff, 2.2)
        scene.add(ambient)
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.4)
        dirLight.position.set(50, 80, 50)
        dirLight.castShadow = true
        scene.add(dirLight)
        const rimLight = new THREE.DirectionalLight(0xced7e0, 0.6)
        rimLight.position.set(-40, 30, -40)
        scene.add(rimLight)

        setIsLoading(false)

        function animate() {
          if (cancelled) return
          animFrameId = requestAnimationFrame(animate)
          controls.update()
          renderer.render(scene, camera)
        }
        animate()

        let resizeRafId: number | null = null
        const resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const { width, height } = entry.contentRect
            if (width <= 0 || height <= 0) continue

            if (resizeRafId !== null) cancelAnimationFrame(resizeRafId)
            resizeRafId = requestAnimationFrame(() => {
              if (!cameraRef.current || !rendererRef.current) return
              const cam = cameraRef.current
              const rnd = rendererRef.current

              cam.aspect = width / height
              cam.updateProjectionMatrix()
              rnd.setSize(width, height, false)
              rnd.setPixelRatio(Math.min(window.devicePixelRatio, 2))
            })
          }
        })
        resizeObserver.observe(container)


  return () => {
          cancelled = true
          if (animFrameId !== null) cancelAnimationFrame(animFrameId)
          if (resizeRafId !== null) cancelAnimationFrame(resizeRafId)
          if (resizeObserver) resizeObserver.disconnect()

          if (sceneRef.current) {
            sceneRef.current.traverse((child: any) => {
              if (child.geometry) child.geometry.dispose()
              if (child.material) {
                if (Array.isArray(child.material)) {
                  child.material.forEach((m: any) => m.dispose())
                } else {
                  child.material.dispose()
                }
              }
            })
          }

          if (renderer) {
            renderer.dispose()
            if (typeof renderer.forceContextLoss === 'function') {
              renderer.forceContextLoss()
            }
            if (renderer.domElement && renderer.domElement.parentElement) {
              renderer.domElement.parentElement.removeChild(renderer.domElement)
            }
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
  }, [geometryKey])

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
        <div className="absolute inset-0 flex items-center justify-center cad-viewport-glass z-10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 w-3/4 max-w-xs p-4 rounded-lg bg-[var(--app-surface)]/90 border border-[color:var(--app-border)] shadow-lg">
            <Skeleton className="w-full h-28 rounded-md" />
            <div className="flex flex-col items-center gap-1.5 w-full">
              <Skeleton className="w-3/4 h-3.5 rounded" />
              <span className="text-[11px] font-mono tracking-wider text-[var(--app-text-muted)]">INITIALIZING 3D VIEWPORT...</span>
            </div>
          </div>
        </div>
      )}
      <div ref={mountRef} className="w-full h-full" />

      {/* Axis dimension pill — only while the user turns annotation on. Measurements
          belong to the 读数 module (DESIGN.md section 6), and section 4 asks for a
          calm viewport by default: no family badge, no BBOX chip, no watermark.
          Plain mono text, not an accent colour: section 11 removed the separate
          measurement hue. */}
      {controlsState.showDimensions && dimLabels.w && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-[5] pointer-events-none flex items-center gap-1.5 rounded-full border border-[var(--shell-border)] px-3 py-0.5 backdrop-blur-md"
          style={{ background: 'var(--shell-module-solid)', boxShadow: 'var(--shell-shadow)' }}
        >
          <span className="text-[11px] font-mono tabular-nums text-[var(--shell-text)]"><span className="text-[var(--shell-text-dim)] mr-0.5">X:</span>{dimLabels.w}</span>
          <span className="text-[var(--shell-border)]">|</span>
          <span className="text-[11px] font-mono tabular-nums text-[var(--shell-text)]"><span className="text-[var(--shell-text-dim)] mr-0.5">Y:</span>{dimLabels.d}</span>
          <span className="text-[var(--shell-border)]">|</span>
          <span className="text-[11px] font-mono tabular-nums text-[var(--shell-text)]"><span className="text-[var(--shell-text-dim)] mr-0.5">Z:</span>{dimLabels.h}</span>
        </div>
      )}

      <ViewerControls
        state={controlsState}
        onChange={setControlsState}
        onResetCamera={handleResetCamera}
        onScreenshot={handleScreenshotWithCanvas}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onDownloadStl={onDownloadStl}
        isDownloadingStl={isDownloadingStl}
        hasStl={hasStl ?? Boolean(job.stlPath)}
      />
    </div>
  )
}
