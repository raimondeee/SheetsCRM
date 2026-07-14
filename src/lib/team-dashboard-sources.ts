import { EXAMPLE_SPREADSHEET_ID } from "./default-sheet-config";
import { letterToIndex } from "./types";

/** Region label for the local Form Responses intake tab. */
export const LOCAL_TEAM_REGION = "North East and Canada";

export interface TeamTabColumnMap {
  timestamp: number;
  status: number;
  owner: number;
  category: number;
}

export interface TeamTabSource {
  id: string;
  region: string;
  sheetName: string;
  gid: string;
  columns: TeamTabColumnMap;
}

function cols(letters: {
  timestamp: string;
  status: string;
  owner: string;
  category: string;
}): TeamTabColumnMap {
  return {
    timestamp: letterToIndex(letters.timestamp),
    status: letterToIndex(letters.status),
    owner: letterToIndex(letters.owner),
    category: letterToIndex(letters.category),
  };
}

export const TEAM_SPREADSHEET_ID = EXAMPLE_SPREADSHEET_ID;

export const TEAM_TAB_SOURCES: TeamTabSource[] = [
  {
    id: "west-coast",
    region: "West Coast and Beach",
    sheetName: "Sheet31",
    gid: "914818793",
    columns: cols({ timestamp: "A", status: "N", owner: "G", category: "K" }),
  },
  {
    id: "great-lakes",
    region: "Great Lakes and Smoky Mountains",
    sheetName: "Sheet32",
    gid: "2057128065",
    columns: cols({ timestamp: "A", status: "K", owner: "D", category: "J" }),
  },
  {
    id: "south-east",
    region: "South East",
    sheetName: "Sheet33",
    gid: "430297604",
    columns: cols({ timestamp: "A", status: "N", owner: "G", category: "K" }),
  },
  {
    id: "adventure-rocky",
    region: "Adventure and Rocky Mountain",
    sheetName: "Sheet34",
    gid: "1492289265",
    columns: cols({ timestamp: "A", status: "L", owner: "G", category: "J" }),
  },
  {
    id: "brssa",
    region: "BRSSA",
    sheetName: "Sheet35",
    gid: "860670685",
    columns: cols({ timestamp: "A", status: "AB", owner: "Q", category: "X" }),
  },
  {
    id: "mx",
    region: "MX",
    sheetName: "Sheet36 BOTH",
    gid: "272043903",
    columns: cols({ timestamp: "A", status: "M", owner: "K", category: "L" }),
  },
];
