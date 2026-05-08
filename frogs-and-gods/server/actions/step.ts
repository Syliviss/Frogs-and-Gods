import { makeMoveHandler } from "./_moveHelper";

// STEP — Move exactly 1 tile (Chebyshev distance 1).
// Universal action: always available on the Action Bar, no item required.
export const stepHandler = makeMoveHandler("STEP");
