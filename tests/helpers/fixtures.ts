import type { FileDiff, Hunk, Line } from "@/ipc/types";

function context(oldNo: number, newNo: number, content: string): Line {
  return { kind: "context", oldNo, newNo, content };
}

function add(newNo: number, content: string): Line {
  return { kind: "add", oldNo: null, newNo, content };
}

function del(oldNo: number, content: string): Line {
  return { kind: "del", oldNo, newNo: null, content };
}

const userServiceHunks: Hunk[] = [
  {
    header: "@@ -30,7 +30,9 @@ class UserService",
    oldStart: 30,
    oldLines: 7,
    newStart: 30,
    newLines: 9,
    lines: [
      context(33, 33, "  public function save(User $u) {"),
      context(34, 34, "    $this->validate($u);"),
      add(35, "    if (!$u->email) {"),
      add(36, "      throw new BadRequest('email');"),
      add(37, "    }"),
      del(35, "    $this->repo->persist($u);"),
      add(38, "    $this->repo->save($u);"),
      context(36, 39, "  }"),
    ],
  },
  {
    header: "@@ -98,4 +100,6 @@ class UserService",
    oldStart: 98,
    oldLines: 4,
    newStart: 100,
    newLines: 6,
    lines: [
      context(98, 100, "  private function map(array $r) {"),
      add(101, "    $r['id'] = (int) $r['id'];"),
      context(99, 102, "    return new User($r);"),
      context(100, 103, "  }"),
    ],
  },
];

export const modifiedFile: FileDiff = {
  path: "src/UserService.php",
  oldPath: null,
  status: "M",
  additions: 5,
  deletions: 1,
  hunks: userServiceHunks,
};

export const addedFile: FileDiff = {
  path: "src/order/Order.ts",
  oldPath: null,
  status: "A",
  additions: 3,
  deletions: 0,
  hunks: [
    {
      header: "@@ -0,0 +1,3 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 3,
      lines: [
        add(1, "export interface Order {"),
        add(2, "  id: string;"),
        add(3, "}"),
      ],
    },
  ],
};

export const deletedFile: FileDiff = {
  path: "src/legacy.ts",
  oldPath: null,
  status: "D",
  additions: 0,
  deletions: 2,
  hunks: [
    {
      header: "@@ -1,2 +0,0 @@",
      oldStart: 1,
      oldLines: 2,
      newStart: 0,
      newLines: 0,
      lines: [del(1, "export const legacy = true;"), del(2, "")],
    },
  ],
};

export const sampleFiles: FileDiff[] = [modifiedFile, addedFile, deletedFile];
