import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import * as THREE from "three";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Milestone M3 Adversarial Challenge: 3D Viewport Grounding & STL Download", () => {
  // ─── 1. Bounding Box Grounding Math (Y_min = 0.000) ─────────────────────────
  describe("Task 1: 3D Model Grounding Alignment (Y_min = 0.000)", () => {
    // Exact STL alignment algorithm used in three-d-viewer.tsx (lines 478-487)
    function applyStlGrounding(geometry: THREE.BufferGeometry) {
      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox!;
      if (!bbox || bbox.isEmpty()) {
        throw new Error("STL has no renderable geometry");
      }
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      geometry.translate(-center.x, -bbox.min.y, -center.z);
      geometry.computeBoundingBox();
      geometry.computeVertexNormals();
      return geometry;
    }

    // Group-level alignment in three-d-viewer.tsx (lines 521-529)
    function applyGroupLevelAlignment(mainGroup: THREE.Group) {
      mainGroup.updateMatrixWorld(true);
      const groupBbox = new THREE.Box3().setFromObject(mainGroup);
      if (!groupBbox.isEmpty()) {
        const groupCenter = groupBbox.getCenter(new THREE.Vector3());
        mainGroup.position.x -= groupCenter.x;
        mainGroup.position.y -= groupBbox.min.y;
        mainGroup.position.z -= groupCenter.z;
        mainGroup.updateMatrixWorld(true);
      }
      return groupBbox;
    }

    test("Standard positive bounding box grounds precisely at Y_min = 0.000", () => {
      const geo = new THREE.BoxGeometry(10, 20, 30);
      geo.translate(0, 10, 0); // Y: [0, 20]
      applyStlGrounding(geo);

      expect(geo.boundingBox!.min.y).toBeCloseTo(0.000, 4);
      expect(geo.boundingBox!.max.y).toBeCloseTo(20.000, 4);
    });

    test("Negative coordinate geometry grounds precisely at Y_min = 0.000", () => {
      const geo = new THREE.BoxGeometry(15, 30, 45);
      geo.translate(-50, -100, -200); // Y originally [-115, -85]
      applyStlGrounding(geo);

      expect(geo.boundingBox!.min.y).toBeCloseTo(0.000, 4);
      expect(geo.boundingBox!.max.y).toBeCloseTo(30.000, 4);
      expect(geo.boundingBox!.min.x).toBeCloseTo(-7.500, 4);
      expect(geo.boundingBox!.max.x).toBeCloseTo(7.500, 4);
    });

    test("Extreme aspect ratio and sub-millimeter precision geometry", () => {
      // Extremely thin sheet: 100mm x 0.05mm x 50mm
      const geo = new THREE.BoxGeometry(100, 0.05, 50);
      geo.translate(12.3456, -98.7654, 3.14159);
      applyStlGrounding(geo);

      expect(geo.boundingBox!.min.y).toBeCloseTo(0.000, 5);
      expect(geo.boundingBox!.max.y).toBeCloseTo(0.05, 5);
    });

    test("Massive industrial size geometry (10 meters / 10000mm)", () => {
      const geo = new THREE.BoxGeometry(10000, 5000, 8000);
      geo.translate(500, -2500, 300);
      applyStlGrounding(geo);

      expect(geo.boundingBox!.min.y).toBeCloseTo(0.000, 3);
      expect(geo.boundingBox!.max.y).toBeCloseTo(5000.0, 3);
    });

    test("Multi-mesh group with secondary edges layer maintains Y_min = 0.000", () => {
      const geo = new THREE.CylinderGeometry(20, 20, 40, 32);
      applyStlGrounding(geo);

      const mainGroup = new THREE.Group();
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      mainGroup.add(mesh);

      const edges = new THREE.EdgesGeometry(geo, 30);
      const edgeLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial());
      mainGroup.add(edgeLines);

      applyGroupLevelAlignment(mainGroup);

      const worldBbox = new THREE.Box3().setFromObject(mainGroup);
      expect(worldBbox.min.y).toBeCloseTo(0.000, 4);
      expect(worldBbox.max.y).toBeCloseTo(40.000, 4);
    });

    test("Empty or degenerate geometry throws expected error during grounding", () => {
      const emptyGeo = new THREE.BufferGeometry();
      expect(() => applyStlGrounding(emptyGeo)).toThrow("STL has no renderable geometry");
    });

    // ─── Adversarial Flaw Investigation: Procedural Spur Gear Bore Grounding ────
    test("ADVERSARIAL DEFECT: Procedural gear bore cylinder causes gear body to float above ground", () => {
      // In buildProceduralGear (lines 112-166):
      // body has thickness 8, position.y = thickness / 2 = 4 (Y: [0, 8])
      // bore has height thickness + 0.2 = 8.2, position.y = 4 (Y: [-0.1, 8.1])
      const thickness = 8;
      const rootRadius = 15;
      const boreDiameter = 8;
      const mainGroup = new THREE.Group();

      const bodyGeo = new THREE.CylinderGeometry(rootRadius, rootRadius, thickness, 32);
      const body = new THREE.Mesh(bodyGeo, new THREE.MeshBasicMaterial());
      body.position.y = thickness / 2;
      mainGroup.add(body);

      const boreGeo = new THREE.CylinderGeometry(boreDiameter / 2, boreDiameter / 2, thickness + 0.2, 32);
      const bore = new THREE.Mesh(boreGeo, new THREE.MeshBasicMaterial());
      bore.position.y = thickness / 2;
      mainGroup.add(bore);

      // Group-level alignment in three-d-viewer.tsx
      applyGroupLevelAlignment(mainGroup);

      const worldBbox = new THREE.Box3().setFromObject(mainGroup);
      const bodyWorldBbox = new THREE.Box3().setFromObject(body);
      const boreWorldBbox = new THREE.Box3().setFromObject(bore);

      // The overall group min Y is 0.000, BUT it is held up solely by the bore cylinder!
      expect(worldBbox.min.y).toBeCloseTo(0.000, 4);
      expect(boreWorldBbox.min.y).toBeCloseTo(0.000, 4);

      // The actual gear body is floating 0.100 mm in the air!
      expect(bodyWorldBbox.min.y).toBeCloseTo(0.100, 4);
      expect(bodyWorldBbox.max.y).toBeCloseTo(thickness + 0.100, 4);
    });

    test("Procedural enclosure: bevelExtrude and group-level grounding", () => {
      // Recreate createRoundedRectShape and buildProceduralEnclosure
      function createRoundedRectShape(w: number, h: number, r: number) {
        const shape = new THREE.Shape();
        const hw = w / 2;
        const hh = h / 2;
        r = Math.min(r, hw, hh);
        shape.moveTo(-hw + r, -hh);
        shape.lineTo(hw - r, -hh);
        shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
        shape.lineTo(hw, hh - r);
        shape.quadraticCurveTo(hw, hh, hw - r, hh);
        shape.lineTo(-hw + r, hh);
        shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
        shape.lineTo(-hw, -hh + r);
        shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
        return shape;
      }

      const mainGroup = new THREE.Group();
      const width = 40;
      const depth = 30;
      const height = 15;
      const cornerR = Math.min(width, depth, height) * 0.12;

      const outerShape = createRoundedRectShape(width, depth, cornerR);
      const outerGeo = new THREE.ExtrudeGeometry(outerShape, {
        depth: height,
        bevelEnabled: true,
        bevelThickness: 0.5,
        bevelSize: 0.5,
        bevelSegments: 2,
      });

      const outerMesh = new THREE.Mesh(outerGeo, new THREE.MeshBasicMaterial());
      outerMesh.rotation.x = -Math.PI / 2;
      outerMesh.position.y = 0;
      mainGroup.add(outerMesh);

      // Group-level alignment
      applyGroupLevelAlignment(mainGroup);

      const worldBbox = new THREE.Box3().setFromObject(mainGroup);
      expect(worldBbox.min.y).toBeCloseTo(0.000, 4);
    });

    test("fitCameraToObject: bounds calculation and zero-dimension fallback", () => {
      // In three-d-viewer.tsx lines 32-55
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      const controls = {
        target: new THREE.Vector3(),
        minDistance: 0,
        maxDistance: 0,
        update: () => {},
      };

      // Test with normal object
      const geo = new THREE.BoxGeometry(50, 20, 30);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);

      expect(maxDim).toBe(50);
      const fov = camera.fov * (Math.PI / 180);
      const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.4;
      camera.position.set(center.x + dist * 0.7, center.y + dist * 0.5, center.z + dist * 0.7);

      expect(camera.position.y).toBeGreaterThan(0);
      expect(dist).toBeGreaterThan(50);

      // Test with empty object (zero maxDim)
      const emptyGroup = new THREE.Group();
      const emptyBox = new THREE.Box3().setFromObject(emptyGroup);
      const emptySize = emptyBox.getSize(new THREE.Vector3());
      const emptyMaxDim = Math.max(emptySize.x, emptySize.y, emptySize.z);

      // With empty object, size is (-Infinity or 0), fitCameraToObject returns fallback
      expect(Number.isFinite(emptyMaxDim) && emptyMaxDim > 0).toBe(false);
    });
  });

  // ─── 2. Z-Fighting Prevention & Grid Configuration ──────────────────────────
  describe("Task 1b: Grid Z-Fighting Inspection", () => {
    const viewerCode = readFileSync(
      resolve(process.cwd(), "src/components/cad/three-d-viewer.tsx"),
      "utf-8"
    );

    test("GridHelper is positioned slightly below ground level at y = -0.01", () => {
      expect(viewerCode).toContain("gridHelper.position.y = -0.01");
    });

    test("DEFECT / UNVERIFIED CLAIM: gridHelper material depthWrite is NOT set to false in code", () => {
      // Worker M3 claimed: "将辅助网格下沉 10 微米：gridHelper.position.y = -0.01，同时材质开启 depthWrite: false"
      // Check whether depthWrite is configured anywhere in three-d-viewer.tsx
      const hasDepthWriteFalse = viewerCode.includes("depthWrite = false") || viewerCode.includes("depthWrite: false");
      // This assertion proves empirically whether the worker's claim holds or failed to be implemented!
      expect(hasDepthWriteFalse).toBe(false);
    });

    test("GridHelper default material in Three.js has depthWrite = true", () => {
      const grid = new THREE.GridHelper(120, 24);
      const mat = grid.material as THREE.LineBasicMaterial;
      expect(mat.depthWrite).toBe(true);
    });

    test("Depth buffer resolution analysis: -0.01mm at grazing angles and camera zoom", () => {
      // When camera is at distance D=150, near=0.1, far=1000
      // In standard 24-bit integer depth buffer: z_ndc = (far + near)/(far - near) - (2*far*near)/((far - near)*z)
      const near = 0.1;
      const far = 1000;
      function depthVal(z: number) {
        return (1 / near - 1 / z) / (1 / near - 1 / far);
      }
      // At distance 150mm:
      const zGround = 150.0;
      const zGrid = 150.01; // 0.01mm farther
      const dz = Math.abs(depthVal(zGrid) - depthVal(zGround));
      // In 24-bit buffer, LSB is 1 / (2^24) = 5.96e-8
      const lsb24 = 1 / (2 ** 24);
      // The difference is ~4.4e-7, which is only ~7 LSBs!
      // Without depthWrite: false or polygonOffset, slight float inaccuracy or camera tilt can cause flicker
      expect(dz).toBeGreaterThan(0);
      expect(dz).toBeLessThan(1e-5);
    });
  });

  // ─── 3. ResizeObserver Debounce & Resizing Behavior ────────────────────────
  describe("Task 2: ResizeObserver Debounce & Resizing Behavior", () => {
    const viewerCode = readFileSync(
      resolve(process.cwd(), "src/components/cad/three-d-viewer.tsx"),
      "utf-8"
    );

    test("ResizeObserver attaches to viewport container and cancels prior RAF", () => {
      expect(viewerCode).toContain("const resizeObserver = new ResizeObserver");
      expect(viewerCode).toContain("if (resizeRafId !== null) cancelAnimationFrame(resizeRafId)");
      expect(viewerCode).toContain("resizeObserver.observe(container)");
      expect(viewerCode).toContain("resizeObserver.disconnect()");
    });

    test("Debounce logic executes only once for rapid burst of resize events", async () => {
      // Simulate the RAF debounce pattern from three-d-viewer.tsx
      let resizeRafId: number | null = null;
      let executedCount = 0;
      let lastWidth = 0;
      let lastHeight = 0;

      // Mock RAF and cancelRAF in Bun environment
      const scheduledCallbacks: Array<{ id: number; fn: () => void }> = [];
      let nextId = 1;
      const mockRaf = (fn: () => void) => {
        const id = nextId++;
        scheduledCallbacks.push({ id, fn });
        return id;
      };
      const mockCancelRaf = (id: number) => {
        const idx = scheduledCallbacks.findIndex(item => item.id === id);
        if (idx !== -1) scheduledCallbacks.splice(idx, 1);
      };

      function onResize(width: number, height: number) {
        if (width <= 0 || height <= 0) return;
        if (resizeRafId !== null) mockCancelRaf(resizeRafId);
        resizeRafId = mockRaf(() => {
          lastWidth = width;
          lastHeight = height;
          executedCount++;
        });
      }

      // Simulate a burst of 100 rapid resize events (user dragging panel slider)
      for (let w = 500; w <= 600; w++) {
        onResize(w, 400);
      }

      // Only 1 callback should remain queued
      expect(scheduledCallbacks.length).toBe(1);

      // Execute queued RAF callback
      scheduledCallbacks[0].fn();

      expect(executedCount).toBe(1);
      expect(lastWidth).toBe(600);
      expect(lastHeight).toBe(400);
    });

    test("Zero or negative dimensions are safely filtered out without throwing", () => {
      let rafTriggered = false;
      function handleEntry(w: number, h: number) {
        if (w <= 0 || h <= 0) return false;
        rafTriggered = true;
        return true;
      }

      expect(handleEntry(0, 500)).toBe(false);
      expect(handleEntry(-100, 500)).toBe(false);
      expect(handleEntry(500, 0)).toBe(false);
      expect(handleEntry(500, -50)).toBe(false);
      expect(rafTriggered).toBe(false);

      expect(handleEntry(800, 600)).toBe(true);
      expect(rafTriggered).toBe(true);
    });

    test("DEFECT / LATENT RESILIENCE ISSUE: Initial zero-dimension check causes permanent unmount skip", () => {
      // In three-d-viewer.tsx lines 393-397:
      // const w = container.clientWidth
      // const h = container.clientHeight
      // if (w === 0 || h === 0) { setIsLoading(false); return }
      //
      // If the container mounts when hidden/collapsed (w === 0), useEffect exits early.
      // Because ResizeObserver is set up inside Promise.all AFTER this check,
      // a container that begins collapsed never gets a ResizeObserver attached,
      // and won't re-run the effect unless geometryKey changes!
      const lines = viewerCode.split("\n");
      const earlyReturnIdx = lines.findIndex(l => l.includes("if (w === 0 || h === 0)"));
      const observerIdx = lines.findIndex(l => l.includes("new ResizeObserver"));

      expect(earlyReturnIdx).toBeGreaterThan(0);
      expect(observerIdx).toBeGreaterThan(earlyReturnIdx);
      // Confirmed: early return precedes ResizeObserver instantiation
    });
  });

  // ─── 4. STL Binary Download Pipeline ─────────────────────────────────────────
  describe("Task 3: STL Binary Download Flow (API, Blob, Naming, ObjectURL)", () => {
    const useWorkspaceCode = readFileSync(
      resolve(process.cwd(), "src/components/cad/workspace/useWorkspaceState.ts"),
      "utf-8"
    );
    const viewerPanelCode = readFileSync(
      resolve(process.cwd(), "src/components/cad/workspace/ViewerPanel.tsx"),
      "utf-8"
    );

    function computeFilename(jobId: string, partFamily?: string) {
      const safePart = (partFamily || "part").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      return `${jobId.slice(0, 8)}-${safePart}.stl`;
    }

    test("Filename formatting: matches `${id.slice(0,8)}-${family}.stl` specification", () => {
      expect(computeFilename("c3a5b2e1-4567-89ab-cdef-0123456789ab", "spur_gear"))
        .toBe("c3a5b2e1-spur_gear.stl");

      expect(computeFilename("job-12345678", "Electronics_Enclosure"))
        .toBe("job-1234-electronics_enclosure.stl");

      expect(computeFilename("abcdef12", "Phone Stand / Holder!"))
        .toBe("abcdef12-phone_stand___holder_.stl");

      expect(computeFilename("87654321", undefined))
        .toBe("87654321-part.stl");

      expect(computeFilename("87654321", ""))
        .toBe("87654321-part.stl");
    });

    test("useWorkspaceState and ViewerPanel share identical download logic", () => {
      expect(useWorkspaceCode).toContain("fetch(`/api/jobs/${job.id}/artifacts/stl`");
      expect(useWorkspaceCode).toContain("credentials: 'include'");
      expect(useWorkspaceCode).toContain("const blob = await res.blob()");
      expect(useWorkspaceCode).toContain("const url = URL.createObjectURL(blob)");
      expect(useWorkspaceCode).toContain("setTimeout(() => URL.revokeObjectURL(url), 1000)");

      expect(viewerPanelCode).toContain("fetch(`/api/jobs/${job.id}/artifacts/stl`");
      expect(viewerPanelCode).toContain("credentials: 'include'");
      expect(viewerPanelCode).toContain("const blob = await res.blob()");
      expect(viewerPanelCode).toContain("const url = URL.createObjectURL(blob)");
      expect(viewerPanelCode).toContain("setTimeout(() => URL.revokeObjectURL(url), 1000)");
    });

    test("STL download state machine & ObjectURL lifecycle simulation", async () => {
      let createdUrlCount = 0;
      let revokedUrlCount = 0;
      const revokedUrls: string[] = [];

      // Mock URL and DOM
      const originalCreate = URL.createObjectURL;
      const originalRevoke = URL.revokeObjectURL;

      URL.createObjectURL = (blob: Blob) => {
        createdUrlCount++;
        return `blob:http://localhost/${createdUrlCount}`;
      };
      URL.revokeObjectURL = (url: string) => {
        revokedUrlCount++;
        revokedUrls.push(url);
      };

      try {
        // Simulate downloadStl execution
        const mockBlob = new Blob(["solid test STL binary data"], { type: "application/sla" });
        const url = URL.createObjectURL(mockBlob);
        expect(url).toBe("blob:http://localhost/1");

        // Simulate link click
        const filename = computeFilename("testjob123456", "spur_gear");
        expect(filename).toBe("testjob1-spur_gear.stl");

        // Simulate 1000ms timer revocation
        let timerFired = false;
        const timerPromise = new Promise<void>((resolveTimer) => {
          setTimeout(() => {
            URL.revokeObjectURL(url);
            timerFired = true;
            resolveTimer();
          }, 50); // compressed timer for test speed
        });

        await timerPromise;

        expect(timerFired).toBe(true);
        expect(revokedUrlCount).toBe(1);
        expect(revokedUrls).toContain("blob:http://localhost/1");
      } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
      }
    });

    test("Download guards against jobs without generated STL artifact", async () => {
      // Verify defensive checks in code
      expect(useWorkspaceCode).toContain("if (!job.stlPath)");
      expect(viewerPanelCode).toContain("if (!job.stlPath)");
      expect(useWorkspaceCode).toContain("STL file has not been generated for this job");
      expect(viewerPanelCode).toContain("STL file has not been generated for this job");
    });

    test("Download guards against duplicate concurrent download requests", () => {
      expect(useWorkspaceCode).toContain("if (downloadingStlJobId === job.id) return");
      expect(viewerPanelCode).toContain("if (internalDownloadingStl) return");
    });
  });
});
