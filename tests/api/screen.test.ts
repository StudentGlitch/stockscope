import { NextRequest } from "next/server";
import { GET } from "../../app/api/screen/route";

// Very basic mock of getDB for Jest
jest.mock("@/lib/mongodb", () => ({
  getDB: jest.fn().mockResolvedValue({
    collection: jest.fn().mockReturnValue({
      aggregate: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            metadata: [{ total: 2 }],
            data: [
              { code: "BBCA", hierarchyLevel: "High", lastPrice: 9000 },
              { code: "BMRI", hierarchyLevel: "High", lastPrice: 6000 },
            ],
          },
        ]),
      }),
    }),
  }),
}));

describe("GET /api/screen", () => {
  it("should process sector and price filters correctly and return 50 items/page logic", async () => {
    const mockRequest = new NextRequest(
      new URL("http://localhost:3000/api/screen?sector=Finance&minPrice=5000&maxPrice=10000")
    );

    const response = await GET(mockRequest);
    const result = await response.json();

    expect(result.success).toBe(true);
    expect(result.limit).toBe(50);
    expect(result.page).toBe(1);
    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].ticker).toBe("BBCA");
    expect(result.data[1].ticker).toBe("BMRI");
  });
});
