// Advanced fields intentionally moved into ordinary expandable sections in 0.6.
// Use a real summary click; never force an action on an invisible control.
exports.revealSection = async (page, section) => {
  const panel = page.locator(`[data-section="${section}"]`);
  await panel.waitFor({ state: "attached" });
  {
    if ((await panel.getAttribute("open")) === null)
      await panel.locator(":scope > summary").click();
  }
};
