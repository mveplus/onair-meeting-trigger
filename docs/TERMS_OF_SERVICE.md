# Terms of Service — ON-AIR Meeting Trigger

**Last updated:** 2026-05-30

## 1. Acceptance
By installing or using the ON-AIR Meeting Trigger browser extension
("the Extension"), you agree to these Terms of Service ("Terms"). If
you do not agree, do not install or use the Extension.

## 2. What the Extension is
The Extension is a free, open-source Chromium/Chrome browser extension
that detects when tabs matching configured meeting services (Google
Meet, Microsoft Teams, Zoom, or user-defined services) are open or
active, and sends HTTP requests to **endpoints you configure
yourself** to signal that state. It runs entirely on your device.

## 3. License
The source code is released under the [MIT License](../LICENSE). You
may fork, modify, and redistribute it under those terms. These Terms
supplement (and do not replace) the MIT License for the published
build distributed via the Chrome Web Store.

## 4. No account, no fee
The Extension does not require you to create an account or pay any
fee. There is no maintainer-operated backend.

## 5. Your responsibilities
You are solely responsible for:

- The endpoints you configure the Extension to call (e.g. Home
  Assistant, smart-home devices, webhooks, cloud services you have
  deployed).
- Any credentials or tokens you give the Extension. They are stored
  locally in your browser's extension storage and transmitted only
  to endpoints you configure.
- Any cloud infrastructure you deploy to support the Extension — for
  example, an AWS Lambda + API Gateway "cloud bridge" you provision
  in your own AWS account. You own that infrastructure, its cost,
  and its security. The maintainer of the Extension has no access
  to it.
- Backing up your configuration via **Export Settings** before
  reflashing, reinstalling, or switching browsers.
- Complying with the rules of any meeting service you use the
  Extension to detect, and with the acceptable-use policies of any
  service the Extension calls into.

## 6. Third-party services
The Extension is distributed via the [Chrome Web Store](https://chromewebstore.google.com/)
and your use of it is also governed by Google's terms for the store.
If you opt to use the AWS IoT cloud-bridge integration documented in
the project, your use of Amazon Web Services is governed by AWS's own
terms. The maintainer is not party to either of those agreements.

## 7. Privacy
The Extension does not collect or transmit personal data to the
maintainer or any third party. See the
[Privacy Policy](PRIVACY.md) for full details.

## 8. No warranty
THE EXTENSION IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
NON-INFRINGEMENT.

In practical terms:

- Browser APIs and meeting-service URLs may change at any time and
  break detection.
- Network conditions and third-party services you configure may
  fail independently of the Extension.
- The Extension is a small open-source project maintained on a
  best-effort basis. There is no service-level commitment.

## 9. Limitation of liability
TO THE FULLEST EXTENT PERMITTED BY LAW, IN NO EVENT SHALL THE
MAINTAINER BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE,
DATA, OR USE, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE
EXTENSION.

Examples (without limitation): the Extension failing to detect a
meeting and your indicator staying off; an indicator turning on at
an awkward moment; cloud-bridge invocations incurring AWS charges;
a misconfigured endpoint sending traffic to the wrong device.

Where applicable law does not allow complete exclusion of liability,
the maintainer's total liability for all claims relating to the
Extension shall not exceed the amount you paid for it — which is
zero.

## 10. Changes to the Extension
The maintainer may at any time modify, suspend, or discontinue
features of the Extension, or stop maintaining the project entirely.
The MIT-licensed source remains available regardless.

## 11. Changes to these Terms
These Terms may be updated. The latest version will always live at
[docs/TERMS_OF_SERVICE.md](TERMS_OF_SERVICE.md) in the project
repository. Continuing to use the Extension after a change means you
accept the updated Terms. Material changes will also be noted in the
relevant GitHub release notes.

## 12. Consumer rights
If you reside in the European Union, the United Kingdom, or another
jurisdiction with non-waivable consumer-protection rights, nothing
in these Terms limits any right you have under the law of your
country of residence.

## 13. Contact
For questions about these Terms, please open an issue at:
<https://github.com/mveplus/onair-meeting-trigger/issues>
