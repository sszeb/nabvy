A `bought` verdict corrected to `real_deal` (the user misclicked) leaves `v_bought_for_reports`
computed live from the stored verdict, so the correction removes the row rather than leaving a
stale one.
