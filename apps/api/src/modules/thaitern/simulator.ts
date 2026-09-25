/** Financial Simulator (journey step 9). Deterministic: no AI involved. */

export interface FinanceParams {
  unit: string;
  basePrice: number;
  baseUnitsPerMonth: number;
  unitCost: number;
  fixedCostPerMonth: number;
  wagePerStaff: number;
  unitsPerStaff: number;
  priceElasticity: number;
  marketingLift: number;
  baseHeadcount: number;
  baseMarketing: number;
}

export interface SimInputs {
  price: number;
  marketing: number;
  headcount: number;
}

export function simulate(p: FinanceParams, i: SimInputs) {
  const priceFactor = Math.pow(i.price / p.basePrice, p.priceElasticity);
  const marketingFactor = 1 + p.marketingLift * Math.log1p(Math.max(0, i.marketing - p.baseMarketing) / 10000);
  const demand = p.baseUnitsPerMonth * priceFactor * marketingFactor;
  const capacity = i.headcount * p.unitsPerStaff;
  const units = Math.round(Math.max(0, Math.min(demand, capacity)));
  const revenue = units * i.price;
  const variable = units * p.unitCost;
  const staff = i.headcount * p.wagePerStaff;
  const totalCost = variable + p.fixedCostPerMonth + staff + i.marketing;
  const profit = revenue - totalCost;
  const margin = i.price - p.unitCost;
  const breakEvenUnits = margin > 0 ? Math.ceil((p.fixedCostPerMonth + staff + i.marketing) / margin) : null;
  return {
    demand: Math.round(demand),
    capacity,
    units,
    capacityBound: demand > capacity,
    revenue: Math.round(revenue),
    totalCost: Math.round(totalCost),
    profit: Math.round(profit),
    breakEvenUnits,
  };
}
