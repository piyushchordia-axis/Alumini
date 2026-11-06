import { describe, expect, it } from "vitest";
import {
  ANALYTICS_RANGES,
  SERIES,
  analyticsView,
  analyticsWeeks,
  completenessRows,
  contentSeries,
  deltaView,
  kpiTiles,
  percent,
  rangeSpan,
  unitFor,
  weekRows,
  type AnalyticsChart,
  type TenantAnalyticsDto,
} from "@illuminize/shared";

const ALL_ON = { feed: true, jobs: true, events: true };

function analytics(over: Partial<TenantAnalyticsDto> = {}): TenantAnalyticsDto {
  return {
    timeZone: "Asia/Kolkata",
    weeks: ["2026-10-19", "2026-10-26", "2026-11-02"],
    kpis: { members: 1234, newMembers: 12, newMembersPrev: 10, activeMembers: 40, activeMembersPrev: 50, posts: 6, postsPrev: 0 },
    series: { joined: [2, 4, 6], registered: [3, 4, 7], active: [20, 25, 30], posts: [1, 2, 3], comments: [4, 0, 5], jobs: [0, 1, 0], events: [0, 0, 1] },
    coverage: {
      yearsOf: "BATCH",
      batches: [
        { label: "2015", count: 4 },
        { label: "2016", count: 9 },
      ],
      cities: [{ label: "Mumbai", count: 12 }],
      countries: [{ label: "India", count: 20 }],
      professions: [],
      completeness: { total: 20, photo: 10, headline: 5, city: 20, company: 0, industry: 1, skills: 2, pastRoles: 3, education: 4, birthday: 5, linkedin: 6, anyLink: 7, email: 8 },
      fields: [
        { key: "chapter", label: "Chapter", options: [{ label: "North", count: 3 }] },
        { key: "volunteer", label: "Volunteers", options: [] },
      ],
    },
    invites: { total: 5, sent: 3, accepted: 1 },
    ...over,
  };
}

const charts = (sections: ReturnType<typeof analyticsView>) => sections.flatMap((s) => s.charts);
const byId = (sections: ReturnType<typeof analyticsView>, id: string): AnalyticsChart => {
  const c = charts(sections).find((x) => x.id === id);
  if (!c) throw new Error(`no ${id} card`);
  return c;
};

describe("the analytics periods", () => {
  it("are 12 weeks, 6 months and 12 months", () => {
    expect(ANALYTICS_RANGES.map((r) => [r.weeks, r.label])).toEqual([
      [12, "Last 12 weeks"],
      [26, "Last 6 months"],
      [52, "Last 12 months"],
    ]);
    expect([12, 26, 52, 8].map(rangeSpan)).toEqual(["12 weeks", "6 months", "12 months", "8 weeks"]);
  });

  it("take an address's ?weeks= only when it is one of them", () => {
    expect(analyticsWeeks("26")).toBe(26);
    expect(analyticsWeeks(52)).toBe(52);
    expect(analyticsWeeks(["52", "12"])).toBe(52);
    expect(analyticsWeeks("13")).toBe(12);
    expect(analyticsWeeks("104")).toBe(12);
    expect(analyticsWeeks(undefined)).toBe(12);
    expect(analyticsWeeks("abc")).toBe(12);
  });
});

describe("deltaView", () => {
  it("says the direction in its text, so the arrow and any colour only repeat it", () => {
    expect(deltaView(12, 10, 12)).toEqual({ direction: "up", text: "+20% vs the previous 12 weeks (10)" });
    expect(deltaView(40, 50, 26)).toEqual({ direction: "down", text: "-20% vs the previous 6 months (50)" });
    expect(deltaView(5, 5, 52)).toEqual({ direction: "flat", text: "0% vs the previous 12 months (5)" });
  });

  it("groups the previous figure", () => {
    expect(deltaView(2000, 1500, 12).text).toBe("+33% vs the previous 12 weeks (1,500)");
  });

  it("has nothing to compare with when the previous period had none", () => {
    expect(deltaView(6, 0, 12)).toEqual({ direction: "none", text: "None in the previous 12 weeks" });
    expect(deltaView(0, 0, 26)).toEqual({ direction: "none", text: "None in this or the previous 6 months" });
    expect(deltaView(0, 0, 52).text).toBe("None in this or the previous 12 months");
  });
});

describe("kpiTiles", () => {
  it("lists the four headline figures, compared over the period the data covers", () => {
    const tiles = kpiTiles(analytics());
    expect(tiles.map((t) => [t.key, t.label, t.valueText])).toEqual([
      ["members", "Approved members", "1,234"],
      ["newMembers", "New members", "12"],
      ["activeMembers", "Active members", "40"],
      ["posts", "Posts", "6"],
    ]);
    expect(tiles[0]!.hint).toBe("12 joined in this period");
    expect(tiles[0]!.delta).toBeUndefined();
    // Three weeks of data: "3 weeks", whatever range was picked since.
    expect(tiles[1]).toMatchObject({ hint: "+20% vs the previous 3 weeks (10)", delta: { direction: "up" } });
    expect(tiles[2]!.delta?.direction).toBe("down");
    expect(tiles[3]).toMatchObject({ hint: "None in the previous 3 weeks", delta: { direction: "none" } });
    const months = kpiTiles(analytics({ weeks: new Array<string>(26).fill("2026-11-02") }));
    expect(months[1]!.hint).toBe("+20% vs the previous 6 months (10)");
  });
});

describe("completenessRows and percent", () => {
  it("lists every detail in the card's order", () => {
    expect(completenessRows(analytics().coverage.completeness).map((r) => r.label)).toEqual([
      "Photo",
      "Headline",
      "City",
      "Company",
      "Industry",
      "Skills",
      "Past roles",
      "Education",
      "Birthday",
      "LinkedIn",
      "Any link",
      "Confirmed email",
    ]);
  });

  it("gives 0% of nobody rather than dividing by zero", () => {
    expect(percent(5, 0)).toBe(0);
    expect(percent(1, 3)).toBe(33);
    const empty = analyticsView(analytics({ coverage: { ...analytics().coverage, completeness: { ...analytics().coverage.completeness, total: 0 } } }), ALL_ON);
    const card = byId(empty, "completeness");
    expect(card.empty).toBe(true);
    expect(card.kind === "hbar" && card.rows.every((r) => r.count === 0)).toBe(true);
  });
});

describe("contentSeries", () => {
  it("draws a line for each kind of content switched on, in order", () => {
    expect(contentSeries(analytics(), ALL_ON).map((s) => [s.name, s.color])).toEqual([
      ["Posts", SERIES[0]],
      ["Comments", SERIES[1]],
      ["Jobs", SERIES[2]],
      ["Events", SERIES[3]],
    ]);
  });

  it("gives the palette's colours to the lines that are there, leaving no gap", () => {
    expect(contentSeries(analytics(), { feed: false, jobs: true, events: true }).map((s) => [s.name, s.color])).toEqual([
      ["Jobs", SERIES[0]],
      ["Events", SERIES[1]],
    ]);
    expect(contentSeries(analytics(), { feed: true, jobs: false, events: false }).map((s) => [s.name, s.color])).toEqual([
      ["Posts", SERIES[0]],
      ["Comments", SERIES[1]],
    ]);
    expect(contentSeries(analytics(), { feed: false, jobs: false, events: false })).toEqual([]);
  });
});

describe("weekRows", () => {
  it("names each week with its year, then each column's value", () => {
    expect(weekRows(["2026-10-26", "2026-11-02"], [[1, 2], [3]])).toEqual([
      ["26 Oct 2026", 1, 3],
      ["2 Nov 2026", 2, 0],
    ]);
  });
});

describe("analyticsView", () => {
  it("orders the cards: growth and activity, then who the members are, with a card per profile question", () => {
    const view = analyticsView(analytics(), ALL_ON);
    expect(view.map((s) => s.heading)).toEqual([undefined, "Who your members are"]);
    expect(view.map((s) => s.charts.map((c) => c.id))).toEqual([
      ["new-members", "active-members", "activity"],
      ["batches", "completeness", "cities", "countries", "professions", "field:chapter", "field:volunteer", "invitations"],
    ]);
    expect(charts(view).map((c) => c.title)).toEqual([
      "New members per week",
      "Active members per week",
      "Activity per week",
      "Members by batch",
      "Profile completeness",
      "Top cities",
      "Countries",
      "Professions",
      "Chapter",
      "Volunteers",
      "Invitations",
    ]);
    expect(charts(view).map((c) => c.kind)).toEqual(["column", "line", "line", "column", "hbar", "hbar", "hbar", "hbar", "hbar", "hbar", "hbar"]);
    // Only the activity card takes a whole row.
    expect(charts(view).filter((c) => c.wide).map((c) => c.id)).toEqual(["activity"]);
  });

  it("has no activity card while no kind of content is switched on", () => {
    const view = analyticsView(analytics(), { feed: false, jobs: false, events: false });
    expect(view[0]!.charts.map((c) => c.id)).toEqual(["new-members", "active-members"]);
  });

  it("gives each card's table its columns and rows", () => {
    const view = analyticsView(analytics(), ALL_ON);
    const columns = Object.fromEntries(charts(view).map((c) => [c.id, c.table.columns]));
    expect(columns).toEqual({
      "new-members": ["Week", "Approved", "Signed up"],
      "active-members": ["Week", "Active members"],
      activity: ["Week", "Posts", "Comments", "Jobs", "Events"],
      batches: ["Batch", "Members"],
      completeness: ["Detail", "Members", "Share"],
      cities: ["Top cities", "Members"],
      countries: ["Countries", "Members"],
      professions: ["Professions", "Members"],
      "field:chapter": ["Chapter", "Members"],
      "field:volunteer": ["Volunteers", "Members"],
      invitations: ["Stage", "Invitations"],
    });
    expect(byId(view, "new-members").table.rows).toEqual([
      ["19 Oct 2026", 2, 3],
      ["26 Oct 2026", 4, 4],
      ["2 Nov 2026", 6, 7],
    ]);
    expect(byId(view, "completeness").table.rows[0]).toEqual(["Photo", 10, "50%"]);
    expect(byId(view, "invitations").table.rows).toEqual([
      ["Imported", 5],
      ["Sent", 3],
      ["Joined", 1],
    ]);
  });

  it("keeps the screen-reader summaries the web console has always had", () => {
    const view = analyticsView(analytics(), ALL_ON);
    expect(Object.fromEntries(charts(view).map((c) => [c.id, c.ariaLabel]))).toEqual({
      "new-members": "New members per week, 12 in total",
      "active-members": "Active members per week",
      activity: "Activity per week: Posts 6, Comments 9, Jobs 1, Events 1",
      batches: "Members by batch",
      completeness: "Profile completeness: Photo 50%, Headline 25%, City 100%, Company 0%, Industry 5%, Skills 10%, Past roles 15%, Education 20%, Birthday 25%, LinkedIn 30%, Any link 35%, Confirmed email 40%",
      cities: "Top cities: Mumbai 12",
      countries: "Countries: India 20",
      professions: "Professions: ",
      "field:chapter": "Chapter: North 3",
      "field:volunteer": "Volunteers: ",
      invitations: "Invitations: 5 imported, 3 sent, 1 joined",
    });
  });

  it("labels weeks for the axis and titles them for the readout", () => {
    const card = byId(analyticsView(analytics(), ALL_ON), "new-members");
    if (card.kind !== "column") throw new Error("new members is a column chart");
    expect(card.labels).toEqual(["19 Oct", "26 Oct", "2 Nov"]);
    expect(card.titles).toEqual(["Week of 19 Oct 2026", "Week of 26 Oct 2026", "Week of 2 Nov 2026"]);
    expect(unitFor(card.unit, 1)).toBe("approved");
    const batches = byId(analyticsView(analytics(), ALL_ON), "batches");
    if (batches.kind !== "column") throw new Error("batches is a column chart");
    expect(batches.titles).toEqual(["Batch of 2015", "Batch of 2016"]);
    expect([unitFor(batches.unit, 1), unitFor(batches.unit, 4)]).toEqual(["member", "members"]);
  });

  it("counts a community's members by the year they joined, in the card's words, table and summary", () => {
    const view = analyticsView(analytics({ coverage: { ...analytics().coverage, yearsOf: "JOINED", batches: [{ label: "1996", count: 3 }, { label: "2005", count: 1 }] } }), ALL_ON);
    const card = byId(view, "batches");
    if (card.kind !== "column") throw new Error("the years card is a column chart");
    expect(card).toMatchObject({ title: "Members by year joined", subtitle: "Approved members by the year they joined", ariaLabel: "Members by year joined" });
    expect(card.labels).toEqual(["1996", "2005"]);
    expect(card.titles).toEqual(["Joined in 1996", "Joined in 2005"]);
    expect(card.table).toEqual({ columns: ["Year joined", "Members"], rows: [["1996", 3], ["2005", 1]] });
    // Every other card is the same as anywhere else.
    const others = (sections: ReturnType<typeof analyticsView>) => charts(sections).filter((c) => c.id !== "batches").map((c) => c.title);
    expect(others(view)).toEqual(others(analyticsView(analytics(), ALL_ON)));
  });

  it("marks a card empty when its period has nothing, with its own words where it has them", () => {
    const quiet = analytics({
      series: { joined: [0, 0, 0], registered: [0, 1, 0], active: [0, 0, 0], posts: [0, 0, 0], comments: [0, 0, 0], jobs: [0, 0, 0], events: [0, 0, 0] },
      coverage: { ...analytics().coverage, batches: [] },
      invites: { total: 0, sent: 0, accepted: 0 },
    });
    const view = analyticsView(quiet, ALL_ON);
    // A sign-up still waiting for approval counts: its table has it.
    expect(byId(view, "new-members").empty).toBe(false);
    expect(byId(view, "active-members").empty).toBe(true);
    expect(byId(view, "activity").empty).toBe(true);
    expect(byId(view, "batches").empty).toBe(true);
    expect(byId(view, "professions")).toMatchObject({ empty: true, emptyText: "No answers yet." });
    expect(byId(view, "invitations")).toMatchObject({ empty: true, emptyText: "No invitations yet. Import a list from the Invitations page." });
  });

  it("shows completeness as percentages of the members on a scale to 100", () => {
    const card = byId(analyticsView(analytics({ coverage: { ...analytics().coverage, completeness: { ...analytics().coverage.completeness, total: 1500 } } }), ALL_ON), "completeness");
    if (card.kind !== "hbar") throw new Error("completeness is a bar chart");
    expect(card.max).toBe(100);
    expect(card.format?.(84)).toBe("84%");
    expect(card.subtitle).toBe("Share of 1,500 approved members who added each detail");
  });

  it("puts the activity lines in the legend in their colours", () => {
    const card = byId(analyticsView(analytics(), { feed: true, jobs: false, events: true }), "activity");
    expect(card.legend).toEqual([
      { label: "Posts", color: SERIES[0], kind: "line" },
      { label: "Comments", color: SERIES[1], kind: "line" },
      { label: "Events", color: SERIES[2], kind: "line" },
    ]);
  });
});
