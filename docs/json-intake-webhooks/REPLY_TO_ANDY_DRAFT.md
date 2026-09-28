# Reply to Andy — draft, not sent

Hi Andy,

Thanks for testing the receiver against the draft and signing example. Good to hear those line up.

We're updating the launch scope to include `shipment.updated` and `order.shipped`. Yes, the intended behavior is to send tracking whether we purchase the label or you supply a prepaid label. We'll verify the prepaid tracking handoff during testing. Partial shipments will produce shipment updates; the full-order event will wait until all expected quantities have shipped. Creating a label alone won't mark an order shipped.

The sandbox access and signing credentials aren't ready to hand over yet. Once provisioned and verified, we'll share the test credentials and signing secret through an expiring secure link, with the key ID and sandbox instructions separately. Please send your receiver URL when it's ready. No secrets will go in plain-text email.

Please send the RGB-derived PDF with its profile preserved. We'll retain the original unchanged and use it to check the artwork-validation and production path.

`pathfinder@vornan.co` is configured as our internal intake-notification address. I'm confirming who monitors it and will clarify the right support contact before testing starts.

Thanks,
Marcus
