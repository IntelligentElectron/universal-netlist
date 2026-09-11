import { loadNetlist } from "../load-netlist.js";
import { isErrorResult, type ListNetsResult, type ErrorResult } from "../../types.js";

/**
 * List all nets within a design.
 *
 * @param design - Path to design file
 */
export const listNets = async (
  design: string,
  designVariant?: string
): Promise<ListNetsResult | ErrorResult> => {
  const netlist = await loadNetlist(design, designVariant);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const nets = Object.keys(netlist.nets).sort((a, b) => a.localeCompare(b));
  return { design_variant: netlist.design_variant, nets };
};
