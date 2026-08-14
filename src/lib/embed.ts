/**
 * Generates the <iframe> embed snippet an LGU can paste into their own
 * website (CLAUDE.md 7o follow-up) -- so their applicants use the real
 * MuniServe form without ever seeing the <subdomain>.muniserve.ph URL.
 *
 * Includes a small auto-resize script: ApplyPageClient posts its real
 * content height via postMessage (window.parent.postMessage({source:
 * "muniserve-apply", height}, "*")) every time it changes -- the wizard's
 * height varies a lot between screens (a short landing screen vs. the
 * full ~40-field form), so a fixed-height iframe would either clip
 * content or force an ugly double-scrollbar. The listener checks
 * event.origin against this LGU's own domain before trusting a resize
 * message, since the embedding page could contain other frames too.
 *
 * next.config.ts's headers() is what actually allows /apply to be framed
 * at all (frame-ancestors * on that one route; everything else in the
 * app is locked to 'self') -- this function only builds the HTML/JS an
 * LGU pastes in, it doesn't affect whether framing is permitted.
 */
export function buildApplyEmbedSnippet(subdomain: string): string {
  const origin = `https://${subdomain}.muniserve.ph`;
  const frameId = `muniserve-apply-${subdomain}`;
  return `<iframe id="${frameId}" src="${origin}/apply" style="width:100%;border:none;min-height:900px;" title="Business Permit Application"></iframe>
<script>
(function () {
  var frame = document.getElementById("${frameId}");
  window.addEventListener("message", function (event) {
    if (event.origin !== "${origin}") return;
    if (event.data && event.data.source === "muniserve-apply" && typeof event.data.height === "number") {
      frame.style.height = event.data.height + "px";
    }
  });
})();
</script>`;
}
