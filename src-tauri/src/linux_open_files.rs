//! The open-file limit the web process inherits from Flow.
//!
//! Linux hands a process 1024 open files unless it asks for more. That is too few for a web view:
//! on the shared-memory path every window buffer is an open file, and NVIDIA's 580 driver leaks
//! one on the fence waits the web view makes (bug 332147 at bugs.webkit.org, worked around after
//! 2.52). Measured on 2.52.6, scrolling a page makes about 68 of those waits a second, and a
//! reporter's GTX 1060 went from 169 open files to 1023 by resizing the window a few times. The
//! web process then dies with "Too many open files" and takes the page with it.
//!
//! Raising the soft limit to the hard one is what systemd asks programs that need more to do, and
//! child processes inherit it.

/// systemd's default hard limit. A higher one (some containers allow a billion) stays unused,
/// since a program that closes every possible descriptor after a fork would take seconds.
const CEILING: libc::rlim_t = 524_288;

/// The soft limit before and after [`raise`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpenFileLimit {
    pub before: libc::rlim_t,
    pub after: libc::rlim_t,
}

/// The soft limit to ask for, or `None` when the current one is already as high as allowed.
fn raised(soft: libc::rlim_t, hard: libc::rlim_t) -> Option<libc::rlim_t> {
    let target = hard.min(CEILING);
    (target > soft).then_some(target)
}

/// Lifts this process's open-file limit as far as the system allows. Call before the web view
/// starts, since its processes copy the limit when they are spawned. `None` when the limit cannot
/// be read.
pub fn raise() -> Option<OpenFileLimit> {
    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: `limit` is a valid `rlimit` for getrlimit to fill in.
    if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &raw mut limit) } != 0 {
        return None;
    }
    let before = limit.rlim_cur;
    let Some(target) = raised(before, limit.rlim_max) else {
        return Some(OpenFileLimit {
            before,
            after: before,
        });
    };
    limit.rlim_cur = target;
    // SAFETY: `limit` holds the hard limit getrlimit returned and a soft limit no higher than it.
    let after = if unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &raw const limit) } == 0 {
        target
    } else {
        before
    };
    Some(OpenFileLimit { before, after })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifts_the_usual_desktop_limit_to_the_hard_one() {
        assert_eq!(raised(1024, 524_288), Some(524_288));
        assert_eq!(raised(1024, 4096), Some(4096));
    }

    #[test]
    fn stops_at_the_ceiling_when_the_hard_limit_is_unbounded() {
        assert_eq!(raised(1024, libc::RLIM_INFINITY), Some(CEILING));
        assert_eq!(raised(1024, 1_073_741_816), Some(CEILING));
    }

    #[test]
    fn never_lowers_a_limit_that_is_already_high() {
        assert_eq!(raised(524_288, 524_288), None);
        assert_eq!(raised(1_048_576, libc::RLIM_INFINITY), None);
        assert_eq!(raised(1024, 1024), None);
    }

    #[test]
    fn reads_and_keeps_or_raises_the_limit_of_this_process() {
        let limit = raise().expect("the limit of the test process can be read");
        assert!(limit.after >= limit.before);
    }
}
