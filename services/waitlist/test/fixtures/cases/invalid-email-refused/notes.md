Malformed input never reaches a write: `WaitlistSubmitInput` rejects it and `submit()` returns
`waitlist.invalid_input` with no row written.
