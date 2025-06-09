import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock contract interface for testing
class BandPaymentContract {
  constructor() {
    this.bands = new Map();
    this.bandMembers = new Map();
    this.bandBalances = new Map();
    this.nextBandId = 1;
    this.memberCounter = 0;
    this.contractOwner = 'contract-owner';
  }

  // Helper function to create composite keys
  createMemberKey(bandId, member) {
    return `${bandId}-${member}`;
  }

  // Error constants
  ERR_NOT_AUTHORIZED = { type: 'error', value: 100 };
  ERR_BAND_NOT_FOUND = { type: 'error', value: 101 };
  ERR_MEMBER_NOT_FOUND = { type: 'error', value: 102 };
  ERR_INVALID_PERCENTAGE = { type: 'error', value: 103 };
  ERR_INSUFFICIENT_BALANCE = { type: 'error', value: 104 };
  ERR_ALREADY_EXISTS = { type: 'error', value: 105 };
  ERR_INVALID_AMOUNT = { type: 'error', value: 106 };

  // Create a new band
  createBand(name, sender) {
    const bandId = this.nextBandId;
    
    if (this.bands.has(bandId)) {
      return this.ERR_ALREADY_EXISTS;
    }

    this.bands.set(bandId, {
      name,
      owner: sender,
      totalMembers: 0,
      active: true
    });

    this.bandBalances.set(bandId, { balance: 0 });
    this.nextBandId += 1;

    return { type: 'ok', value: bandId };
  }

  // Add member to band
  addMember(bandId, member, memberName, percentage, sender) {
    const bandInfo = this.bands.get(bandId);
    if (!bandInfo) {
      return this.ERR_BAND_NOT_FOUND;
    }

    if (bandInfo.owner !== sender) {
      return this.ERR_NOT_AUTHORIZED;
    }

    if (percentage <= 0 || percentage > 100) {
      return this.ERR_INVALID_PERCENTAGE;
    }

    const memberKey = this.createMemberKey(bandId, member);
    if (this.bandMembers.has(memberKey)) {
      return this.ERR_ALREADY_EXISTS;
    }

    this.bandMembers.set(memberKey, {
      name: memberName,
      percentage,
      totalEarned: 0,
      joinedAt: this.memberCounter
    });

    // Update band info
    bandInfo.totalMembers += 1;
    this.bands.set(bandId, bandInfo);
    this.memberCounter += 1;

    return { type: 'ok', value: true };
  }

  // Update member percentage
  updateMemberPercentage(bandId, member, newPercentage, sender) {
    const bandInfo = this.bands.get(bandId);
    if (!bandInfo) {
      return this.ERR_BAND_NOT_FOUND;
    }

    if (bandInfo.owner !== sender) {
      return this.ERR_NOT_AUTHORIZED;
    }

    const memberKey = this.createMemberKey(bandId, member);
    const memberInfo = this.bandMembers.get(memberKey);
    if (!memberInfo) {
      return this.ERR_MEMBER_NOT_FOUND;
    }

    if (newPercentage <= 0 || newPercentage > 100) {
      return this.ERR_INVALID_PERCENTAGE;
    }

    memberInfo.percentage = newPercentage;
    this.bandMembers.set(memberKey, memberInfo);

    return { type: 'ok', value: true };
  }

  // Deposit payment to band
  depositPayment(bandId, amount, sender) {
    const bandInfo = this.bands.get(bandId);
    if (!bandInfo) {
      return this.ERR_BAND_NOT_FOUND;
    }

    if (amount <= 0) {
      return this.ERR_INVALID_AMOUNT;
    }

    if (!bandInfo.active) {
      return this.ERR_NOT_AUTHORIZED;
    }

    const currentBalance = this.bandBalances.get(bandId) || { balance: 0 };
    currentBalance.balance += amount;
    this.bandBalances.set(bandId, currentBalance);

    return { type: 'ok', value: true };
  }

  // Calculate member share
  calculateMemberShare(balance, percentage) {
    return Math.floor((balance * percentage) / 100);
  }

  // Withdraw member earnings
  withdrawEarnings(bandId, sender) {
    const memberKey = this.createMemberKey(bandId, sender);
    const memberInfo = this.bandMembers.get(memberKey);
    if (!memberInfo) {
      return this.ERR_MEMBER_NOT_FOUND;
    }

    const bandBalance = this.bandBalances.get(bandId);
    if (!bandBalance) {
      return this.ERR_BAND_NOT_FOUND;
    }

    const memberShare = this.calculateMemberShare(bandBalance.balance, memberInfo.percentage);
    if (memberShare <= 0) {
      return this.ERR_INSUFFICIENT_BALANCE;
    }

    // Update member's total earned
    memberInfo.totalEarned += memberShare;
    this.bandMembers.set(memberKey, memberInfo);

    // Update band balance
    bandBalance.balance -= memberShare;
    this.bandBalances.set(bandId, bandBalance);

    return { type: 'ok', value: memberShare };
  }

  // Emergency withdraw (owner only)
  emergencyWithdraw(bandId, sender) {
    const bandInfo = this.bands.get(bandId);
    if (!bandInfo) {
      return this.ERR_BAND_NOT_FOUND;
    }

    if (bandInfo.owner !== sender) {
      return this.ERR_NOT_AUTHORIZED;
    }

    const bandBalance = this.bandBalances.get(bandId);
    if (!bandBalance || bandBalance.balance <= 0) {
      return this.ERR_INSUFFICIENT_BALANCE;
    }

    const totalBalance = bandBalance.balance;
    bandBalance.balance = 0;
    this.bandBalances.set(bandId, bandBalance);

    return { type: 'ok', value: totalBalance };
  }

  // Read-only functions
  getBandInfo(bandId) {
    return this.bands.get(bandId) || null;
  }

  getMemberInfo(bandId, member) {
    const memberKey = this.createMemberKey(bandId, member);
    return this.bandMembers.get(memberKey) || null;
  }

  getBandBalance(bandId) {
    return this.bandBalances.get(bandId) || null;
  }

  calculateMemberEarnings(bandId, member) {
    const memberInfo = this.getMemberInfo(bandId, member);
    const bandBalance = this.getBandBalance(bandId);
    
    if (!memberInfo || !bandBalance) {
      return null;
    }

    return this.calculateMemberShare(bandBalance.balance, memberInfo.percentage);
  }

  getTotalBands() {
    return this.nextBandId - 1;
  }

  isBandMember(bandId, member) {
    const memberKey = this.createMemberKey(bandId, member);
    return this.bandMembers.has(memberKey);
  }
}

describe('Band Payment Splitting Contract', () => {
  let contract;
  const bandOwner = 'band-owner-principal';
  const member1 = 'member1-principal';
  const member2 = 'member2-principal';
  const member3 = 'member3-principal';

  beforeEach(() => {
    contract = new BandPaymentContract();
  });

  describe('Band Creation', () => {
    it('should create a new band successfully', () => {
      const result = contract.createBand('The Test Band', bandOwner);
      
      expect(result.type).toBe('ok');
      expect(result.value).toBe(1);
      
      const bandInfo = contract.getBandInfo(1);
      expect(bandInfo.name).toBe('The Test Band');
      expect(bandInfo.owner).toBe(bandOwner);
      expect(bandInfo.totalMembers).toBe(0);
      expect(bandInfo.active).toBe(true);
    });

    it('should increment band ID for each new band', () => {
      const result1 = contract.createBand('Band 1', bandOwner);
      const result2 = contract.createBand('Band 2', bandOwner);
      
      expect(result1.value).toBe(1);
      expect(result2.value).toBe(2);
      expect(contract.getTotalBands()).toBe(2);
    });

    it('should initialize band balance to zero', () => {
      contract.createBand('Test Band', bandOwner);
      const balance = contract.getBandBalance(1);
      
      expect(balance.balance).toBe(0);
    });
  });

  describe('Member Management', () => {
    let bandId;

    beforeEach(() => {
      const result = contract.createBand('Test Band', bandOwner);
      bandId = result.value;
    });

    it('should add a member successfully', () => {
      const result = contract.addMember(bandId, member1, 'Alice', 40, bandOwner);
      
      expect(result.type).toBe('ok');
      expect(result.value).toBe(true);
      
      const memberInfo = contract.getMemberInfo(bandId, member1);
      expect(memberInfo.name).toBe('Alice');
      expect(memberInfo.percentage).toBe(40);
      expect(memberInfo.totalEarned).toBe(0);
      expect(memberInfo.joinedAt).toBe(0);
    });

    it('should increment member counter for each new member', () => {
      contract.addMember(bandId, member1, 'Alice', 40, bandOwner);
      contract.addMember(bandId, member2, 'Bob', 35, bandOwner);
      
      const member1Info = contract.getMemberInfo(bandId, member1);
      const member2Info = contract.getMemberInfo(bandId, member2);
      
      expect(member1Info.joinedAt).toBe(0);
      expect(member2Info.joinedAt).toBe(1);
    });

    it('should update band member count', () => {
      contract.addMember(bandId, member1, 'Alice', 40, bandOwner);
      contract.addMember(bandId, member2, 'Bob', 35, bandOwner);
      
      const bandInfo = contract.getBandInfo(bandId);
      expect(bandInfo.totalMembers).toBe(2);
    });

    it('should reject adding member with invalid percentage', () => {
      const result1 = contract.addMember(bandId, member1, 'Alice', 0, bandOwner);
      const result2 = contract.addMember(bandId, member2, 'Bob', 101, bandOwner);
      
      expect(result1).toEqual(contract.ERR_INVALID_PERCENTAGE);
      expect(result2).toEqual(contract.ERR_INVALID_PERCENTAGE);
    });

    it('should reject adding member by non-owner', () => {
      const result = contract.addMember(bandId, member1, 'Alice', 40, 'not-owner');
      
      expect(result).toEqual(contract.ERR_NOT_AUTHORIZED);
    });

    it('should reject adding duplicate member', () => {
      contract.addMember(bandId, member1, 'Alice', 40, bandOwner);
      const result = contract.addMember(bandId, member1, 'Alice Again', 30, bandOwner);
      
      expect(result).toEqual(contract.ERR_ALREADY_EXISTS);
    });

    it('should update member percentage successfully', () => {
      contract.addMember(bandId, member1, 'Alice', 40, bandOwner);
      const result = contract.updateMemberPercentage(bandId, member1, 50, bandOwner);
      
      expect(result.type).toBe('ok');
      
      const memberInfo = contract.getMemberInfo(bandId, member1);
      expect(memberInfo.percentage).toBe(50);
    });
  });

  describe('Payment Handling', () => {
    let bandId;

    beforeEach(() => {
      const result = contract.createBand('Test Band', bandOwner);
      bandId = result.value;
      contract.addMember(bandId, member1, 'Alice', 40, bandOwner);
      contract.addMember(bandId, member2, 'Bob', 35, bandOwner);
      contract.addMember(bandId, member3, 'Charlie', 25, bandOwner);
    });

    it('should deposit payment successfully', () => {
      const result = contract.depositPayment(bandId, 1000, 'payer');
      
      expect(result.type).toBe('ok');
      
      const balance = contract.getBandBalance(bandId);
      expect(balance.balance).toBe(1000);
    });

    it('should reject deposit with invalid amount', () => {
      const result = contract.depositPayment(bandId, 0, 'payer');
      
      expect(result).toEqual(contract.ERR_INVALID_AMOUNT);
    });

    it('should calculate member earnings correctly', () => {
      contract.depositPayment(bandId, 1000, 'payer');
      
      const alice_earnings = contract.calculateMemberEarnings(bandId, member1);
      const bob_earnings = contract.calculateMemberEarnings(bandId, member2);
      const charlie_earnings = contract.calculateMemberEarnings(bandId, member3);
      
      expect(alice_earnings).toBe(400); // 40% of 1000
      expect(bob_earnings).toBe(350);   // 35% of 1000
      expect(charlie_earnings).toBe(250); // 25% of 1000
    });

    it('should allow member to withdraw earnings', () => {
      contract.depositPayment(bandId, 1000, 'payer');
      
      const result = contract.withdrawEarnings(bandId, member1);
      
      expect(result.type).toBe('ok');
      expect(result.value).toBe(400);
      
      // Check updated balances
      const memberInfo = contract.getMemberInfo(bandId, member1);
      const bandBalance = contract.getBandBalance(bandId);
      
      expect(memberInfo.totalEarned).toBe(400);
      expect(bandBalance.balance).toBe(600); // 1000 - 400
    });

    it('should reject withdrawal by non-member', () => {
      contract.depositPayment(bandId, 1000, 'payer');
      
      const result = contract.withdrawEarnings(bandId, 'non-member');
      
      expect(result).toEqual(contract.ERR_MEMBER_NOT_FOUND);
    });

    it('should handle multiple withdrawals correctly', () => {
      contract.depositPayment(bandId, 1000, 'payer');
      
      // Alice withdraws
      const result1 = contract.withdrawEarnings(bandId, member1);
      expect(result1.value).toBe(400);
      
      // Bob withdraws
      const result2 = contract.withdrawEarnings(bandId, member2);
      expect(result2.value).toBe(350);
      
      // Check remaining balance
      const bandBalance = contract.getBandBalance(bandId);
      expect(bandBalance.balance).toBe(250); // 1000 - 400 - 350
    });
  });

  describe('Emergency Withdrawal', () => {
    let bandId;

    beforeEach(() => {
      const result = contract.createBand('Test Band', bandOwner);
      bandId = result.value;
      contract.addMember(bandId, member1, 'Alice', 40, bandOwner);
      contract.depositPayment(bandId, 1000, 'payer');
    });

    it('should allow owner to emergency withdraw', () => {
      const result = contract.emergencyWithdraw(bandId, bandOwner);
      
      expect(result.type).toBe('ok');
      expect(result.value).toBe(1000);
      
      const balance = contract.getBandBalance(bandId);
      expect(balance.balance).toBe(0);
    });

    it('should reject emergency withdrawal by non-owner', () => {
      const result = contract.emergencyWithdraw(bandId, 'not-owner');
      
      expect(result).toEqual(contract.ERR_NOT_AUTHORIZED);
    });

    it('should reject emergency withdrawal with no balance', () => {
      // First withdraw all funds
      contract.emergencyWithdraw(bandId, bandOwner);
      
      // Try to withdraw again
      const result = contract.emergencyWithdraw(bandId, bandOwner);
      
      expect(result).toEqual(contract.ERR_INSUFFICIENT_BALANCE);
    });
  });

  describe('Read-Only Functions', () => {
    let bandId;

    beforeEach(() => {
      const result = contract.createBand('Test Band', bandOwner);
      bandId = result.value;
      contract.addMember(bandId, member1, 'Alice', 40, bandOwner);
    });

    it('should check if user is band member', () => {
      expect(contract.isBandMember(bandId, member1)).toBe(true);
      expect(contract.isBandMember(bandId, 'non-member')).toBe(false);
    });

    it('should return null for non-existent band', () => {
      expect(contract.getBandInfo(999)).toBeNull();
      expect(contract.getBandBalance(999)).toBeNull();
    });

    it('should return null for non-existent member', () => {
      expect(contract.getMemberInfo(bandId, 'non-member')).toBeNull();
      expect(contract.calculateMemberEarnings(bandId, 'non-member')).toBeNull();
    });
  });

  describe('Complex Scenarios', () => {
    let bandId;

    beforeEach(() => {
      const result = contract.createBand('Test Band', bandOwner);
      bandId = result.value;
    });

    it('should handle percentage updates and recalculate earnings', () => {
      // Add members
      contract.addMember(bandId, member1, 'Alice', 50, bandOwner);
      contract.addMember(bandId, member2, 'Bob', 50, bandOwner);
      
      // Deposit payment
      contract.depositPayment(bandId, 1000, 'payer');
      
      // Check initial earnings
      expect(contract.calculateMemberEarnings(bandId, member1)).toBe(500);
      expect(contract.calculateMemberEarnings(bandId, member2)).toBe(500);
      
      // Update Alice's percentage
      contract.updateMemberPercentage(bandId, member1, 30, bandOwner);
      contract.updateMemberPercentage(bandId, member2, 70, bandOwner);
      
      // Check updated earnings
      expect(contract.calculateMemberEarnings(bandId, member1)).toBe(300);
      expect(contract.calculateMemberEarnings(bandId, member2)).toBe(700);
    });

    it('should handle zero balance withdrawal attempts', () => {
      contract.addMember(bandId, member1, 'Alice', 40, bandOwner);
      
      const result = contract.withdrawEarnings(bandId, member1);
      
      expect(result).toEqual(contract.ERR_INSUFFICIENT_BALANCE);
    });

    it('should maintain accurate member totals across operations', () => {
      // Add 3 members
      contract.addMember(bandId, member1, 'Alice', 40, bandOwner);
      contract.addMember(bandId, member2, 'Bob', 35, bandOwner);
      contract.addMember(bandId, member3, 'Charlie', 25, bandOwner);
      
      const bandInfo = contract.getBandInfo(bandId);
      expect(bandInfo.totalMembers).toBe(3);
      
      // Verify all members exist
      expect(contract.isBandMember(bandId, member1)).toBe(true);
      expect(contract.isBandMember(bandId, member2)).toBe(true);
      expect(contract.isBandMember(bandId, member3)).toBe(true);
    });
  });
});