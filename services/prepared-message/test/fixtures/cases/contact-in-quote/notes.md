# contact-in-quote

No seller data: synthetic, built from gpu-not-stated with a phone number, a social handle and a
phone number split across a line break added to the confirmed quotes (all made up; the recorded
run's own contact details are masked at export). Every quote passes through quote-redaction's
`redact()`; whitespace is collapsed before redaction, so the split number is masked too.
