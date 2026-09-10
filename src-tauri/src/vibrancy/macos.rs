use objc2::rc::Retained;
use objc2::runtime::NSObjectProtocol;
use objc2::{define_class, msg_send, ClassType, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSResponder, NSView, NSVisualEffectView};
use objc2_foundation::{NSObject, NSRect};

define_class!(
    // SAFETY: NSView has no extra subclassing requirements, and VixlTintView
    // does not implement Drop.
    #[unsafe(super(NSView, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "VixlTintView"]
    pub(super) struct VixlTintView;
);

impl VixlTintView {
    pub(super) fn with_frame(mtm: MainThreadMarker, frame: NSRect) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(());
        unsafe { msg_send![super(this), initWithFrame: frame] }
    }
}

pub(super) fn find_visual_effect_view(
    content_view: &NSView,
) -> Option<Retained<NSVisualEffectView>> {
    let subviews = content_view.subviews();
    for i in 0..subviews.count() {
        let subview = subviews.objectAtIndex(i);
        if !subview.isKindOfClass(NSVisualEffectView::class()) {
            continue;
        }
        if let Ok(effect) = subview.downcast::<NSVisualEffectView>() {
            return Some(effect);
        }
    }
    None
}

pub(super) fn find_tint_view(effect: &NSView) -> Option<Retained<VixlTintView>> {
    let subviews = effect.subviews();
    for i in 0..subviews.count() {
        let subview = subviews.objectAtIndex(i);
        if !subview.isKindOfClass(VixlTintView::class()) {
            continue;
        }
        if let Ok(tint) = subview.downcast::<VixlTintView>() {
            return Some(tint);
        }
    }
    None
}
