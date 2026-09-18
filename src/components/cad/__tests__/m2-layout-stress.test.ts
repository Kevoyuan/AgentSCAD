import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { PanelErrorBoundary } from "../workspace/PanelErrorBoundary";

describe("M2 Layout & Zero Horizontal Overflow Stress Tests", () => {
  // ─── 1. Panel Size Bounds & Mathematical Feasibility ─────────────────────────
  describe("Panel Size Constraints & Clamp Math", () => {
    // Extracted directly from panel definitions:
    // JobListPanel: default 18, min 14, max 30, collapsible, collapsedSize 0
    // ViewerPanel: default 52, min 36
    // InspectorPanel: default 30, min 24, max 42, collapsible, collapsedSize 0
    const LEFT = { default: 18, min: 14, max: 30, collapsed: 0 };
    const VIEWER = { default: 52, min: 36 };
    const INSPECTOR = { default: 30, min: 24, max: 42, collapsed: 0 };

    test("default sizes sum precisely to 100%", () => {
      expect(LEFT.default + VIEWER.default + INSPECTOR.default).toBe(100);
    });

    test("minimum sizes sum is <= 100% (panels can co-exist at min widths)", () => {
      const minSum = LEFT.min + VIEWER.min + INSPECTOR.min;
      expect(minSum).toBe(74);
      expect(minSum).toBeLessThanOrEqual(100);
    });

    test("max left panel with min viewer and min inspector <= 100%", () => {
      expect(LEFT.max + VIEWER.min + INSPECTOR.min).toBe(90);
      expect(LEFT.max + VIEWER.min + INSPECTOR.min).toBeLessThanOrEqual(100);
    });

    test("max inspector panel with min viewer and min left <= 100%", () => {
      expect(INSPECTOR.max + VIEWER.min + LEFT.min).toBe(92);
      expect(INSPECTOR.max + VIEWER.min + LEFT.min).toBeLessThanOrEqual(100);
    });

    test("viewport pixel allocations across standard and compact viewports", () => {
      const viewports = [1920, 1440, 1280, 1024, 768, 640];

      for (const vw of viewports) {
        const leftPx = (vw * LEFT.default) / 100;
        const viewerPx = (vw * VIEWER.default) / 100;
        const inspectorPx = (vw * INSPECTOR.default) / 100;

        // Total pixel sum equals viewport
        expect(Math.round(leftPx + viewerPx + inspectorPx)).toBe(vw);

        // Viewer panel always has sufficient room for 3D canvas / SVG
        expect(viewerPx).toBeGreaterThanOrEqual(230);

        // Min left panel width in pixels
        const leftMinPx = (vw * LEFT.min) / 100;
        // Even at 768px, left panel minimum is ~107px, which accommodates icon-only layout
        expect(leftMinPx).toBeGreaterThanOrEqual(89);
      }
    });

    test("focus mode collapses both sidebars and expands viewer to 100%", () => {
      const focusedLeft = LEFT.collapsed;
      const focusedInspector = INSPECTOR.collapsed;
      const availableForViewer = 100 - focusedLeft - focusedInspector;
      expect(availableForViewer).toBe(100);
    });
  });

  // ─── 2. PanelErrorBoundary Subsystem Isolation & Self-Healing ───────────────
  describe("PanelErrorBoundary Error Isolation & Self-Healing", () => {
    // Helper to wire up a mock React updater for unmounted instance testing
    function createMockBoundary(props: any) {
      const boundary = new PanelErrorBoundary(props);
      (boundary as any).updater = {
        enqueueSetState: (inst: any, partialState: any) => {
          const next =
            typeof partialState === "function"
              ? partialState(inst.state, inst.props)
              : partialState;
          inst.state = { ...inst.state, ...next };
        },
      };
      return boundary;
    }

    test("getDerivedStateFromError captures error safely", () => {
      const testError = new Error("Monaco editor memory spike");
      const state = PanelErrorBoundary.getDerivedStateFromError(testError);
      expect(state.hasError).toBe(true);
      expect(state.error).toBe(testError);
    });

    test("initial state is pristine", () => {
      const boundary = createMockBoundary({
        panelName: "Inspector",
        resetKey: "job_1_SPEC",
        children: null,
      });
      expect(boundary.state.hasError).toBe(false);
      expect(boundary.state.error).toBeNull();
      expect(boundary.state.copied).toBe(false);
    });

    test("componentDidCatch captures errorInfo without crashing", () => {
      const boundary = createMockBoundary({
        panelName: "3D Viewport",
        children: null,
      });
      const error = new Error("WebGL context lost");
      const errorInfo = { componentStack: "at ThreeDViewer at ViewerPanel" };

      boundary.componentDidCatch(error, errorInfo as any);
      expect(boundary.state.errorInfo).toEqual(errorInfo as any);
    });

    test("auto-heals when resetKey changes (e.g. user selects different job)", () => {
      const boundary = createMockBoundary({
        panelName: "3D Viewport",
        resetKey: "job_broken",
        children: null,
      });
      // Simulate error caught
      boundary.state = {
        hasError: true,
        error: new Error("Broken job"),
        errorInfo: null,
        copied: false,
      };

      // User clicks different job -> resetKey changes
      boundary.componentDidUpdate({
        panelName: "3D Viewport",
        resetKey: "job_healthy",
        children: null,
      });

      expect(boundary.state.hasError).toBe(false);
      expect(boundary.state.error).toBeNull();
    });

    test("manual handleReset clears error state and invokes onReset callback", () => {
      let resetCalled = false;
      const boundary = createMockBoundary({
        panelName: "Job List",
        onReset: () => {
          resetCalled = true;
        },
        children: null,
      });

      boundary.state = {
        hasError: true,
        error: new Error("Parse error"),
        errorInfo: null,
        copied: false,
      };

      boundary.handleReset();

      expect(boundary.state.hasError).toBe(false);
      expect(boundary.state.error).toBeNull();
      expect(resetCalled).toBe(true);
    });
  });

  // ─── 3. Static CSS & DOM Elasticity Audit ─────────────────────────────────────
  describe("Source Code DOM & CSS Elasticity Verification", () => {
    const srcDir = resolve(__dirname, "..");

    test("MainWorkspace declares zero horizontal overflow constraints", () => {
      const content = readFileSync(
        resolve(srcDir, "workspace/MainWorkspace.tsx"),
        "utf-8"
      );

      // Root container still clips both axes.
      expect(content).toContain("overflow-hidden");
      expect(content).toContain("h-screen flex flex-col");

      // Stage clips: the canvas is full-bleed and must never scroll.
      expect(content).toContain(
        "flex-1 min-h-0 w-full max-w-full overflow-hidden relative"
      );

      // The resizable panel group is gone (DESIGN.md section 3): the shell is a
      // single full-bleed canvas with absolutely positioned floating modules,
      // so there is no column arithmetic left to overflow.
      expect(content).not.toContain("ResizablePanelGroup");

      // Floating modules are absolutely positioned inside the stage.
      expect(content).toContain("absolute");

      // Secondary surfaces converge on the brand module: settings and
      // notifications are the only two utility entry points, and the seven-item
      // tools dropdown is gone.
      expect(content).toContain("SettingsSheet");
      expect(content).toContain('aria-label="设置"');
      expect(content).not.toContain("WorkspaceToolsMenu");
    });

    test("JobListPanel declares min-w-0 and responsive batch actions", () => {
      const content = readFileSync(
        resolve(srcDir, "workspace/JobListPanel.tsx"),
        "utf-8"
      );

      // Panel has min-w-0 overflow-hidden
      expect(content).toContain('className="cad-left-panel min-w-0 overflow-hidden"');

      // Wraps with PanelErrorBoundary
      expect(content).toContain('<PanelErrorBoundary panelName="Job List"');

      // Batch action bar: quiet ruled strip, wraps, and carries the contextual
      // statistics/comparison actions from DESIGN.md "Secondary surfaces".
      expect(content).toContain('data-testid="slots-batch-bar"');
      // Assert structure, not the exact ordering of utility class names - this
      // assertion broke three times purely because the class string was reordered.
      expect(content).toContain("flex-wrap");
      expect(content).toContain("justify-end");
      expect(content).toContain("onOpenCompare");
      expect(content).toContain("onOpenStats");

      // Labels are always visible now: the bar is a quiet strip of small mono
      // actions, not a toolbar that has to shed text on narrow widths.
      expect(content).toContain("已选");
    });

    test("ViewerPanel declares min-w-0 and isolated PanelErrorBoundary", () => {
      const content = readFileSync(
        resolve(srcDir, "workspace/ViewerPanel.tsx"),
        "utf-8"
      );

      // The viewer is the full-bleed canvas now, not a resizable column
      // (DESIGN.md section 3), but it must still clip and shrink. Assert the tokens
      // rather than one exact class string: the previous exact match broke purely
      // because the class list changed, which is not a defect.
      expect(content).toContain("cad-viewer-panel");
      expect(content).toContain("min-w-0");
      expect(content).toContain("overflow-hidden");

      // Wraps with PanelErrorBoundary
      expect(content).toContain('<PanelErrorBoundary panelName="3D Viewport"');

      // Replaces QuickStartDashboard with CadViewportEmptyState
      expect(content).not.toContain("<QuickStartDashboard");
      expect(content).toContain("CadViewportEmptyState");

      // No docked panel chrome and no second competing primary action: the shell
      // is gone, and the composer owns the only action (DESIGN.md section 5).
      expect(content).not.toContain("ResizablePanel");
      expect(content).not.toContain("Rebuild STL");
    });

    test("InspectorPanel declares min-w-0 and scrollable tabs", () => {
      const content = readFileSync(
        resolve(srcDir, "workspace/InspectorPanel.tsx"),
        "utf-8"
      );

      // Panel has min-w-0 overflow-hidden
      expect(content).toContain('className="cad-inspector-panel min-w-0 overflow-hidden"');

      // Wraps with PanelErrorBoundary
      expect(content).toContain('<PanelErrorBoundary panelName="Inspector"');

      // TabsList has overflow-x-auto to prevent tab explosion on narrow inspector
      expect(content).toContain("overflow-x-auto overflow-y-hidden");
    });

    test("SortableJobCard guards against long unbroken strings", () => {
      const content = readFileSync(
        resolve(srcDir, "sortable-job-card.tsx"),
        "utf-8"
      );

      // Card container has overflow-hidden
      expect(content).toContain("overflow-hidden");

      // Text has line-clamp-2
      expect(content).toContain("line-clamp-2");
    });

    test("empty-states.tsx conforms to DESIGN.md anti-pattern bans", () => {
      const content = readFileSync(
        resolve(srcDir, "workspace/empty-states.tsx"),
        "utf-8"
      );

      // BAP-04: No text gradient clip
      expect(content).not.toContain("bg-clip-text text-transparent");

      // BAP-06: No uncalibrated Loader2 import or JSX rendering
      expect(content).not.toContain("<Loader2");
      expect(content).not.toContain('from "lucide-react"\nimport { Loader2');

      // BAP-03: No glowing drop-shadows
      expect(content).not.toContain("shadow-[0_0_");

      // Uses Skeleton shimmer for loading states
      expect(content).toContain("Skeleton");
    });

    test("the shell converges secondary actions on the brand module, not a dropdown", () => {
      const shell = readFileSync(
        resolve(srcDir, "workspace/MainWorkspace.tsx"),
        "utf-8"
      );

      // DESIGN.md "Secondary surfaces": settings and notifications are the only two
      // utility entry points. Statistics and comparison are contextual to a
      // multi-select in the slots rail; the rest are keystrokes.
      expect(shell).toContain("SettingsSheet");
      expect(shell).toContain('aria-label="设置"');
      expect(shell).not.toContain("WorkspaceToolsMenu");

      const list = readFileSync(resolve(srcDir, "workspace/JobListPanel.tsx"), "utf-8");
      expect(list).toContain("onOpenCompare");
      expect(list).toContain("onOpenStats");
    })

  });
});
