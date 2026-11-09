//! How much one read may take from a store (spec/store.md, Make progress or stop). A cursor that
//! keeps advancing passes that rule, so a total has to end the read too. Both limits sit far above
//! what a group holds, since garbage collection keeps its logs short.

const REQUESTS: u32 = 4096;
pub const OBJECTS: usize = 200_000;

pub struct ReadBudget {
    requests: u32,
    objects: usize,
}

impl Default for ReadBudget {
    fn default() -> Self {
        Self {
            requests: REQUESTS,
            objects: OBJECTS,
        }
    }
}

impl ReadBudget {
    /// Counts one answer naming `objects` objects. False once the read should end.
    pub fn take(&mut self, objects: usize) -> bool {
        self.requests = self.requests.saturating_sub(1);
        self.objects = self.objects.saturating_sub(objects);
        self.requests > 0 && self.objects > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_read_ends_on_too_many_requests_or_too_many_objects() {
        let mut budget = ReadBudget::default();
        assert!((1..REQUESTS).all(|_| budget.take(0)));
        assert!(!budget.take(0));

        let mut budget = ReadBudget::default();
        assert!(budget.take(OBJECTS - 1));
        assert!(!budget.take(1));
    }
}
