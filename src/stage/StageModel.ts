export interface StageGroupInfo {
  id: string;
  name: string;
  members: string[];
}

export interface StageTreeSnapshot {
  groups: StageGroupInfo[];
  ungrouped: string[];
}

export class StageModel {
  private groups = new Map<string, StageGroupInfo>();
  private parentOf = new Map<string, string>();
  private seq = 0;

  createGroup(memberIds: string[]): StageGroupInfo {
    this.seq++;
    const info: StageGroupInfo = {
      id: `g${this.seq}`,
      name: `分组 ${this.seq}`,
      members: [...memberIds],
    };
    this.groups.set(info.id, info);
    for (const m of info.members) this.parentOf.set(m, info.id);
    return info;
  }

  ungroup(groupId: string): string[] {
    const g = this.groups.get(groupId);
    if (!g) return [];
    for (const m of g.members) this.parentOf.delete(m);
    this.groups.delete(groupId);
    return g.members;
  }

  rename(groupId: string, name: string): void {
    const g = this.groups.get(groupId);
    if (g && name.trim()) g.name = name.trim();
  }

  removeModel(modelId: string): void {
    const gid = this.parentOf.get(modelId);
    if (!gid) return;
    const g = this.groups.get(gid);
    if (!g) {
      this.parentOf.delete(modelId);
      return;
    }
    g.members = g.members.filter((m) => m !== modelId);
    this.parentOf.delete(modelId);
  }

  groupOf(modelId: string): string | null {
    return this.parentOf.get(modelId) ?? null;
  }

  hasGroup(groupId: string): boolean {
    return this.groups.has(groupId);
  }

  isEmpty(): boolean {
    return this.groups.size === 0;
  }

  snapshot(allModelIds: string[]): StageTreeSnapshot {
    return {
      groups: [...this.groups.values()].map((g) => ({ ...g, members: [...g.members] })),
      ungrouped: allModelIds.filter((id) => !this.parentOf.has(id)),
    };
  }
}
