/**
 * A design whose own file shows that this server cannot read it, such as an OrCAD
 * design saved in a Capture format older than the one its parser reads. The message
 * says why and what to do about it; `list_designs` lists the design as unsupported
 * with that message, and a query reports it as its error.
 */
export class UnsupportedDesignError extends Error {}
