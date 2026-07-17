import { describe, expect, it } from "vitest";
import {
  extractProductsFromOrderCsv,
  parseCsv,
  splitCsvLine,
  wantsProductListFromCsv,
} from "./csvProducts.js";

const SAMPLE = `id,repository_id,relation_type,relation_id,position,quantity,unit_net_price,tax_value,created_at
59483,15801,product,568,"{""name"":""BeRAW! Kids Żelki Truskawka 35 g"",""index"":""28530"",""unit_name"":""szt.""}",6,29.26956,5,"2026-07-12 21:44:40"
59484,15801,product,790,"{""name"":""BeRAW! Nuts&Honey Pistachio 30 g"",""index"":""30195"",""unit_name"":""szt.""}",2,33.7249,5,"2026-07-12 21:46:01"
59485,15801,product,1084,"{""name"":""Purella Chlorella 200 kaps"",""index"":""29605"",""unit_name"":""szt.""}",4,133.97509,23,"2026-07-12 21:46:11"
`;

describe("csvProducts", () => {
  it("splits quoted CSV fields with escaped quotes", () => {
    const cells = splitCsvLine(
      `1,2,"{""name"":""A"",""index"":""9""}",3`,
    );
    expect(cells).toEqual(["1", "2", '{"name":"A","index":"9"}', "3"]);
  });

  it("extracts all products from BaseLinker-style position JSON", () => {
    const { rows, notes } = extractProductsFromOrderCsv(SAMPLE);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ name: "BeRAW! Kids Żelki Truskawka 35 g", sap: "28530" });
    expect(rows[1]?.sap).toBe("30195");
    expect(rows[2]?.sap).toBe("29605");
    expect(notes).toContain("3 products");
    expect(parseCsv(SAMPLE).rows).toHaveLength(3);
  });

  it("detects product-list intents", () => {
    expect(wantsProductListFromCsv("Extract every product name and SAP index from all CSV rows")).toBe(
      true,
    );
    expect(wantsProductListFromCsv("summarize the invoice tone")).toBe(false);
  });
});
