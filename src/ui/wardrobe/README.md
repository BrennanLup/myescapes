# Wardrobe and character HUD (Phase 3 workstream B)

Exports (`index.ts`): `CharacterHud` (mounted by `App.tsx`), `WardrobeOverlay` (rendered for `overlay.kind === 'wardrobe'`), `openWardrobe()`, `useWardrobe`.

## CharacterHud (`character-hud`)
- Bottom right. Desktop: a "First person / Third person" pill with its `V` key cap (`camera-toggle`, `aria-pressed` in third person) and a "Wardrobe" pill with your key balance (`wardrobe-button`). Touch: two 56 px round buttons (eye / figure, hanger with a key badge), clear of the joystick and the Tap button; they stop pointer propagation so a press is never a world tap.
- Hidden before `worldReady` and while any overlay is open.
- On mount: loads your look once (`installWardrobeSync`), and after you log a room (`entry:saved`) or close Escape of the Day it refreshes your keys and shows a toast such as "+10 keys for the wardrobe".

## WardrobeOverlay (`wardrobe-overlay`)
- A bottom sheet on phones and a two-column dialog from 768 px: live 3D preview (its own small canvas with the same `Character`; drag or arrow keys turn it, it waves when you change something; a text description when there is no WebGL), "Surprise me" (a random free look) and "Undo changes".
- Tabs (`wardrobe-tab-<id>`, arrow keys / Home / End): Skin, Hair, Top, Bottom, Shoes, Hat, Extras. Each shows item tiles (`item-<id>`, `aria-pressed`, `data-locked`) with Free / Owned / a lock and the price, and colour swatches (`swatch-<id>`) where a colour applies.
- Locked items can be tried on. The main button (`wardrobe-primary`) then says "Unlock {item} · {price}" for the cheapest one you can afford (buying the last one also wears the look, in one request), is disabled with "needs N more keys" when you can't, or links to sign in when signed out. Otherwise it is "Save look", which saves, shows a toast and closes.
- Messages and errors are announced in a polite live region (`wardrobe-message`). Esc, the close button, Cancel or a backdrop click close without saving. Tab is kept inside the dialog.
- "Earn keys" card (`earn-info`): the rules (10 per room, 5 per Escape of the Day, no real money) and your totals.

## Store (`store.ts`)
`useWardrobe`: `status`, `signedIn`, `outfit` (what you wear), `owned`, `keys`, `busy`, `load()`, `save(outfit)`, `buy(itemId, wear?)`. Signed in it uses `GET/PUT /api/me/avatar` and `POST /api/me/avatar/purchases` (src/contracts/avatar.ts). Signed out (the demo room) free looks are kept in `localStorage['myescapes.outfit.v1']` and nothing can be bought.

## Logic (`logic.ts`, tested)
`TABS`, `tabItems` (free first, then by price), `colorApplies`, `primaryAction`, `priceLabel`, `stepIndex`.

## Tests
`logic.test.ts` and `wardrobe.test.tsx` (save, unlock and wear, too few keys, server refusal, signed out, keyboard, undo, the HUD toggle, touch layout, the keys toast). The e2e is `e2e/character.spec.ts`.
