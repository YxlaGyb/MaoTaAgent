export interface AdmissionLimits {
  per_owner: number;
  total: number;
}

export class Admission {
  private readonly limits: AdmissionLimits;
  private readonly owners = new Map<string, number>();
  private total = 0;

  constructor(limits: AdmissionLimits) {
    this.limits = limits;
  }

  take(owner?: string): void {
    if (this.total >= this.limits.total) throw new Error(`job limit reached: ${this.limits.total} running jobs`);
    if (owner !== undefined) {
      const count = this.owners.get(owner) ?? 0;
      if (count >= this.limits.per_owner) {
        throw new Error(`owner ${owner} already has ${this.limits.per_owner} running jobs`);
      }
      this.owners.set(owner, count + 1);
    }
    this.total += 1;
  }

  release(owner?: string): void {
    this.total = Math.max(0, this.total - 1);
    if (owner === undefined) return;
    const count = this.owners.get(owner) ?? 0;
    if (count <= 1) this.owners.delete(owner);
    else this.owners.set(owner, count - 1);
  }
}