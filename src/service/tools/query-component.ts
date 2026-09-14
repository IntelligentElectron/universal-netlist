import { getDesignName } from "../../paths.js";
import { loadNetlist } from "../load-netlist.js";
import { MPN_MISSING_NOTE } from "../component-grouping.js";
import { isErrorResult, type QueryComponentResult, type ErrorResult } from "../../types.js";

/**
 * Query component details by reference designator.
 *
 * @param design - Path to design file
 * @param refdes - Component reference designator
 * @param designVariant - Native design variant, or `<Default>` for the core design
 */
export const queryComponent = async (
  design: string,
  refdes: string,
  designVariant?: string,
  password?: string
): Promise<QueryComponentResult | ErrorResult> => {
  const netlist = await loadNetlist(design, designVariant, password);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const targetRefdes = refdes.trim();
  const componentEntry = Object.entries(netlist.components).find(
    ([key]) => key.toLowerCase() === targetRefdes.toLowerCase()
  );

  if (!componentEntry) {
    const designName = getDesignName(design);
    return {
      error: `Component '${refdes}' not found in design '${designName}'. Use list_components() or search_components_by_refdes() to find available components.`,
    };
  }

  const [resolvedRefdes, component] = componentEntry;
  const mpn = component.mpn?.trim() || undefined;
  const dns = component.dns ?? false;

  const result: QueryComponentResult = {
    design_variant: netlist.design_variant,
    refdes: resolvedRefdes,
    pins: component.pins,
  };

  if (mpn !== undefined) {
    result.mpn = mpn;
  }

  const internalPn = component.internal_pn?.trim() || undefined;
  if (internalPn !== undefined) {
    result.internal_pn = internalPn;
  }

  const manufacturer = component.manufacturer?.trim() || undefined;
  if (manufacturer !== undefined) {
    result.manufacturer = manufacturer;
  }

  if (component.description !== undefined) {
    result.description = component.description;
  }
  if (component.comment !== undefined) {
    result.comment = component.comment;
  }
  if (component.value !== undefined) {
    result.value = component.value;
  }
  if (dns) {
    result.dns = true;
  }
  if (component.alternate_part) {
    result.alternate_part = true;
  }
  if (!mpn) {
    result.notes = [MPN_MISSING_NOTE];
  }

  return result;
};
