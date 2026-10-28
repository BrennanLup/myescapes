# Wardrobe and character HUD (Phase 3 workstream B)

Exports (`index.ts`): `CharacterHud` (mounted by `App.tsx`), `WardrobeOverlay` (rendered for `overlay.kind === 'wardrobe'`), `openWardrobe()`, `useWardrobe`.

## CharacterHud (`character-hud`)
- Bottom right. Desktop: a "First person / Third person" pill with its `V` key cap (`camera-toggle`, `aria-pressed` in third person) and a "Wardrobe" pill with your key balance (`wardrobe-button`). Touch: two 56 px round buttons (eye / figure, hanger with a key badge at its bottom left, away from the camera button), clear of the joystick and the Tap button; they stop pointer propagation so a press is never a world tap.
- Hidden before `worldReady` and while any overlay is open.
- On mount: loads your look once (`installWardrobeSync`), and after you log a room (`entry:saved`) or close Escape of the Day it refreshes your keys and shows a toast such as "+10 keys for the wardrobe".

## WardrobeOverlay (`wardrobe-overlay`)
- A bottom sheet on phones and a two-column dialog from 768 px: live 3D preview (its own small canvas with the same `Character`; drag or arrow keys turn it, it waves when you change something; a text description when there is no WebGL; WebGL is probed once per page and the probe context is released at once, so opening the wardrobe never pushes the room's context out), "Surprise me" (a random free look) and "Undo changes".
- Tabs (`wardrobe-tab-<id>`, arrow keys / Home / End): Skin, Hair, Top, Bottom, Shoes, Hat, Extras. On narrow screens the strip scrolls: the edge that hides more tabs fades (with a chevron on the right; `data-more-start` / `data-more-end`), and the active tab is scrolled into view. Tab pills have no colour transition, so the active label is never teal on teal. Each shows item tiles (`item-<id>`, `aria-pressed`, `data-locked`) with Free / Owned / a lock and the price, and colour swatches (`swatch-<id>`) where a colour applies.
- Locked items can be tried on. The main button (`wardrobe-primary`) then says "Unlock {item} · {price}" for the cheapest one you can afford (the item name shows on phones too, truncated if it must be), is disabled with "needs N more keys" when you can't, or links to sign in when signed out. Otherwise it is "Save look", which saves, shows a toast and closes.
- An unlock always wears what you bought, in the same request: the whole look when it was the last locked item (toast, close), otherwise the look with the still-locked items swapped back to what you wear today (`wearableDraft`). The wardrobe then stays open on the rest ("Unlocked Headphones and put it on. Detective trench is still locked"), and the hint says so before you press ("... stays locked for now"). Discarding the rest keeps what you bought on.
- "Wear what you own" (`wardrobe-wear-owned`, next to the message) appears while the look has locked items you can't afford and keeping only the owned parts would still change something: it swaps those items back so you can save the rest.
- Item tiles: the dark teal ring and check mark what you are trying on; a small "Wearing" tag (`data-wearing`) marks what you wear today. Selected text, the active tab and the chips use darker shades that pass WCAG AA at their sizes (dark teal `#1f6f6b`: 5.9:1 white on it, 4.9:1 on the selected tile).
- Colour swatches on phones sit in balanced rows (`swatchColumns`: 8 skin tones are 4 + 4, not 7 + 1); from 640 px they wrap in one row.
- Messages and errors are announced in a polite live region (`wardrobe-message`). Esc, the close button, Cancel (`wardrobe-cancel`) or a backdrop click close it; when what you are trying on differs from your saved look they first ask "Discard this look?" (`wardrobe-discard`: "Keep trying on" is focused, Esc also keeps it; "Discard" closes). Tab is kept inside the dialog.
- "Earn keys" card (`earn-info`): the rules (10 per room, 5 per Escape of the Day, no real money) and your totals. When you spent more than you now have earned (you deleted rooms whose keys you spent), it says the next N keys you earn pay that back first (`earn-owed`).

## Store (`store.ts`)
`useWardrobe`: `status`, `signedIn`, `outfit` (what you wear), `owned`, `keys`, `busy`, `load()`, `save(outfit)`, `buy(itemId, wear?)`. Signed in it uses `GET/PUT /api/me/avatar` and `POST /api/me/avatar/purchases` (src/contracts/avatar.ts). Signed out (the demo room) free looks are kept in `localStorage['myescapes.outfit.v1']` and nothing can be bought.

## Logic (`logic.ts`, tested)
`TABS`, `tabItems` (free first, then by price), `colorApplies`, `primaryAction` (with `rest`, the other locked items), `wearableDraft`, `listNames`, `swatchColumns`, `priceLabel`, `stepIndex`, `scrollEdges`.

## Tests
`logic.test.ts`, `preview.test.ts` (the one-time WebGL probe) and `wardrobe.test.tsx` (save, unlock and wear, too few keys, server refusal, signed out, keyboard, the discard prompt, undo, the HUD toggle, touch layout, the keys toast). The e2e is `e2e/character.spec.ts`.
