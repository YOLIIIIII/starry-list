// Window-local composition material; all COM objects stay on the UI thread.
// Uses the documented host backdrop, not the focus-dependent DWM Acrylic preset.
use std::cell::RefCell;
use windows::{
    core::{Interface, BOOL},
    System::{DispatcherQueue, DispatcherQueueController},
    Win32::{
        Foundation::HWND,
        Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_HOSTBACKDROPBRUSH},
        System::WinRT::{
            Composition::ICompositorDesktopInterop, CreateDispatcherQueueController,
            DispatcherQueueOptions, DQTAT_COM_STA, DQTYPE_THREAD_CURRENT,
        },
    },
    UI::{
        Composition::{Compositor, Desktop::DesktopWindowTarget, SpriteVisual},
        ViewManagement::{AccessibilitySettings, UISettings},
    },
};

thread_local! {
    static QUEUE: RefCell<Option<DispatcherQueueController>> = const { RefCell::new(None) };
    static MATERIAL: RefCell<Option<Material>> = const { RefCell::new(None) };
}
struct Material {
    hwnd: HWND,
    compositor: Compositor,
    target: DesktopWindowTarget,
    root: SpriteVisual,
}
fn host_enabled(hwnd: HWND, enabled: bool) -> windows::core::Result<()> {
    let value = BOOL::from(enabled);
    // SAFETY: HWND comes from the main Tauri window, value and size match BOOL.
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_HOSTBACKDROPBRUSH,
            (&value as *const BOOL).cast(),
            size_of::<BOOL>() as u32,
        )
    }
}
impl Drop for Material {
    fn drop(&mut self) {
        let _ = self.target.Close();
        let _ = self.root.Close();
        let _ = self.compositor.Close();
        let _ = host_enabled(self.hwnd, false);
    }
}
fn create(hwnd: HWND) -> windows::core::Result<Material> {
    if DispatcherQueue::GetForCurrentThread().is_err() {
        QUEUE.with(|slot| -> windows::core::Result<()> {
            if slot.borrow().is_none() {
                // SAFETY: create only for this UI thread and retain its controller.
                let queue = unsafe {
                    CreateDispatcherQueueController(DispatcherQueueOptions {
                        dwSize: size_of::<DispatcherQueueOptions>() as u32,
                        threadType: DQTYPE_THREAD_CURRENT,
                        apartmentType: DQTAT_COM_STA,
                    })?
                };
                *slot.borrow_mut() = Some(queue);
            }
            Ok(())
        })?;
    }
    let compositor = Compositor::new()?;
    let interop: ICompositorDesktopInterop = compositor.cast()?;
    // SAFETY: own visible main HWND; false puts material behind WebView children.
    let target = unsafe { interop.CreateDesktopWindowTarget(hwnd, false)? };
    let root = compositor.CreateSpriteVisual()?;
    let material = Material {
        hwnd,
        compositor,
        target,
        root,
    };
    host_enabled(hwnd, true)?;
    let brush = material.compositor.CreateHostBackdropBrush()?;
    material.root.SetBrush(&brush)?;
    material
        .root
        .SetRelativeSizeAdjustment(windows_numerics::Vector2 { X: 1.0, Y: 1.0 })?;
    // A single, focus-independent tint softens the backdrop without row chips.
    let tint = material.compositor.CreateSpriteVisual()?;
    tint.SetRelativeSizeAdjustment(windows_numerics::Vector2 { X: 1.0, Y: 1.0 })?;
    tint.SetBrush(
        &material
            .compositor
            .CreateColorBrushWithColor(windows::UI::Color {
                A: 82,
                R: 247,
                G: 239,
                B: 253,
            })?,
    )?;
    material.root.Children()?.InsertAtTop(&tint)?;
    material.target.SetRoot(&material.root)?;
    Ok(material)
}
pub fn set(hwnd: HWND, enabled: bool) -> Result<bool, String> {
    // Initialize queue TLS first so it outlives the material at thread shutdown.
    QUEUE.with(|_| {});
    MATERIAL.with(|slot| {
        // Taking drops the previous tree before a replacement, also on failure.
        slot.borrow_mut().take();
        if !enabled {
            return Ok(false);
        }
        let allowed = UISettings::new()
            .and_then(|s| s.AdvancedEffectsEnabled())
            .map_err(|e| e.to_string())?
            && !AccessibilitySettings::new()
                .and_then(|s| s.HighContrast())
                .map_err(|e| e.to_string())?;
        if !allowed {
            return Ok(false);
        }
        let material = create(hwnd).map_err(|e| e.to_string())?;
        *slot.borrow_mut() = Some(material);
        Ok(true)
    })
}
pub fn clear() {
    MATERIAL.with(|slot| {
        slot.borrow_mut().take();
    });
}
pub fn active() -> bool {
    MATERIAL.with(|slot| slot.borrow().is_some())
}
