# text-facts

Synthetic descriptions, one rule each, positive and negative:

1. A UK phone number: off-platform contact (W2).
2. Row 18's "@ BACK PANEL" and "No Scammers" (dataset.json:6135): nothing.
3. "Facebook delivery" and a payment link: platform claim (L3).
4. A facebook.com link is not a platform claim.
5. A link that is not Facebook's: platform claim and off-platform contact.
6. The away story (W1).
7. Urgency (W4).
8. A full description under 40 characters: thin text (W3).
9. The same text marked `partial`: text rules on the description do not run (unknown).
10. "Never used for mining": negated, nothing.
11. "Ex mining" in the title: mining wording (gpu-pc.md:40).
12. PayPal goods and services: protected payment (X2).
13. "For spares or repairs" and "sold as seen": not working (for parts) and untested.
14. A `missing` description: its "untested" is not read.
