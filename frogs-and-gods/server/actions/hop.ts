import { makeMoveHandler } from "./_moveHelper";

// HOP — Move up to 2 tiles (Chebyshev distance 2).
// Universal action: always available on the Action Bar, no item required.
export const hopHandler = makeMoveHandler("HOP");
