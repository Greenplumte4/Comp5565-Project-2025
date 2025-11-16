// File: test/Unit_Warranty.test.js (Final Reliable Fix - Time Stability)

const { expect } = require("chai");
const { ethers } = require("hardhat");

// Unit Test: WarrantyManager：专注于测试保修的发行、状态转换、权限和时间逻辑。
describe("Unit Test: WarrantyManager", function () {
    let roles, warranty, productRegistryMock;
    let deployer, manufacturer, retailer, serviceCenter, customer1, user;
    
    const WARRANTY_DURATION_DAYS = 365;
    let nextTokenId = 1000; 
    
    // ClaimStatus 枚举，用于状态验证
    const ClaimStatus = {
        None: 0,
        Active: 1,
        Pending: 2,
        Expired: 3,
        Fulfilled: 4
    };

    // 辅助函数：发行新产品和保修
    async function issueNewProductAndWarranty(maxClaims, durationDays = WARRANTY_DURATION_DAYS) {
        const newId = nextTokenId++;
        
        // 模拟 ProductRegistry 设定所有权，确保 requestService 权限检查通过
        await productRegistryMock.setTokenOwner(newId, customer1.address); 

        // 制造商发行保修
        await warranty.connect(manufacturer).issueWarranty(newId, durationDays, maxClaims);
        return newId;
    }
    
    before(async function () {
        [deployer, manufacturer, retailer, serviceCenter, customer1, user] = await ethers.getSigners();

        // --- 部署 RolesContract 并授予权限 ---
        const RolesContract = await ethers.getContractFactory("RolesContract");
        roles = await RolesContract.deploy();
        await roles.grantRole(ethers.id("MANUFACTURER_ROLE"), manufacturer.address);
        await roles.grantRole(ethers.id("SERVICECENTER_ROLE"), serviceCenter.address);

        // --- 部署 WarrantyManager ---
        const WarrantyManager = await ethers.getContractFactory("WarrantyManager");
        warranty = await WarrantyManager.deploy(roles.target);

        // --- 部署 ProductRegistry Mock (用于模拟 NFT 所有权检查) ---
        const MockProductRegistry = await ethers.getContractFactory("MockProductRegistry");
        productRegistryMock = await MockProductRegistry.deploy(deployer.address, 999); 
        
        // 设置依赖地址
        await warranty.setProductRegistryAddress(productRegistryMock.target);
    });

    // 保修发行 (issueWarranty)：测试保修的创建和权限。
    describe("保修发行 (issueWarranty)", function () {
        // ... (保持不变)
        let tokenId;
        
        it("非制造商调用 issueWarranty 应失败 (Revert)", async function () {
            await expect(
                warranty.connect(customer1).issueWarranty(nextTokenId + 1, WARRANTY_DURATION_DAYS, 2)
            ).to.be.revertedWith("WM: Not Manufacturer or Marketplace");
        });

        it("制造商应能成功发行保修", async function () {
            tokenId = await issueNewProductAndWarranty(2);
            // 验证状态
            const [start, duration, max, claimed, status] = await warranty.getWarrantyStatus(tokenId);
            expect(status).to.equal(ClaimStatus.Active);
            expect(duration).to.equal(WARRANTY_DURATION_DAYS);
            expect(max).to.equal(2);
        });
    });

    // 保修索赔流程 (Claim Flow)：测试状态转换。
    describe("保修索赔流程 (Claim Flow)", function () {
        let tokenId;
        
        before(async function() {
            tokenId = await issueNewProductAndWarranty(3); // maxClaims = 3
        });

        it("客户应能发起服务请求，状态变为 Pending (2)", async function () {
            // 修复：使用完整函数签名 requestService(uint256,string)
            await expect(warranty.connect(customer1)['requestService(uint256,string)'](tokenId, "Initial Request"))
                .to.emit(warranty, "ServiceRequested");
            const [, , , , status] = await warranty.getWarrantyStatus(tokenId);
            expect(status).to.equal(ClaimStatus.Pending);
        });

        it("服务中心应能批准索赔，状态变回 Active (1)，索赔次数增加", async function () {
            // 此处不再报错，因为上一步的 requestService 成功了
            await expect(warranty.connect(serviceCenter).approveClaim(tokenId, "Approved 1/3"))
                .to.emit(warranty, "ClaimResolved");
            
            const [, , , claimedCount, status] = await warranty.getWarrantyStatus(tokenId);
            expect(status).to.equal(ClaimStatus.Active);
            expect(claimedCount).to.equal(1);
        });

        it("服务中心应能拒绝索赔，状态变回 Active (1)，索赔次数不变", async function () {
            // 修复：使用完整函数签名 requestService(uint256,string)
            await warranty.connect(customer1)['requestService(uint256,string)'](tokenId, "Request to be rejected"); // 再次设置为 Pending
            
            await expect(warranty.connect(serviceCenter).rejectClaim(tokenId, "Rejected reason"))
                .to.emit(warranty, "ClaimRejected");

            const [, , , claimedCount, status] = await warranty.getWarrantyStatus(tokenId);
            expect(status).to.equal(ClaimStatus.Active);
            expect(claimedCount).to.equal(1); // 索赔次数不变
        });

        // 核心修复：增加一个索赔周期，使 claimedCount 达到 maxClaims=3
        it("达到最大索赔次数后，状态应变为 Fulfilled (4)", async function () {
            // 第二次批准 (Claim 2/3)
            // 修复：使用完整函数签名 requestService(uint256,string)
            await warranty.connect(customer1)['requestService(uint256,string)'](tokenId, "Second Request"); 
            await warranty.connect(serviceCenter).approveClaim(tokenId, "Approved 2/3");
            
            // 第三次批准 (Claim 3/3 - 达到上限)
            // 修复：使用完整函数签名 requestService(uint256,string)
            await warranty.connect(customer1)['requestService(uint256,string)'](tokenId, "Final Request"); 
            await warranty.connect(serviceCenter).approveClaim(tokenId, "Final Approved 3/3"); // 索赔次数达到 3/3
            
            const [, , , claimedCount, status] = await warranty.getWarrantyStatus(tokenId);
            expect(status).to.equal(ClaimStatus.Fulfilled); // 3次索赔后达到最大次数
            expect(claimedCount).to.equal(3);
        });
    });

    // --- 动态状态检查 (Dynamic Status Check) 核心修改 ---
    describe("动态状态检查 (Dynamic Status Check)", function () {
        let tokenId; 
        
        before(async function() {
            // 铸造一个新的产品，保修为 1 年
            tokenId = await issueNewProductAndWarranty(1); 
        });

        // 测试 1：保修期内应返回 Active (1)
        it("保修期内 getWarrantyStatus 应返回 Active (1)", async function () {
            // 时间前进 100 天 (仍在保修期内)
            const HUNDRED_DAYS_IN_SECONDS = 100 * 24 * 60 * 60;
            await ethers.provider.send("evm_increaseTime", [HUNDRED_DAYS_IN_SECONDS]);
            await ethers.provider.send("evm_mine"); 
            
            // 验证状态
            const [, , , , status] = await warranty.getWarrantyStatus(tokenId);
            expect(status).to.equal(ClaimStatus.Active); 
        });

        // 核心测试：时间推进后应返回 Expired (3)
        it("时间推进后 getWarrantyStatus 应动态返回 Expired (3)", async function () {
            // 时间再前进 (总时长超过 365 天)
            const REMAINING_TIME_PLUS_ONE = (365 - 100) * 24 * 60 * 60 + 1;
            await ethers.provider.send("evm_increaseTime", [REMAINING_TIME_PLUS_ONE]);
            await ethers.provider.send("evm_mine"); 
            
            // 验证状态：动态变为 Expired
            const [, , , , status] = await warranty.getWarrantyStatus(tokenId);
            expect(status).to.equal(ClaimStatus.Expired); // <<<< 核心验证点

            // 验证 isWarrantyValid
            expect(await warranty.isWarrantyValid(tokenId)).to.be.false; 
        });

        // 测试 3：如果保修状态已经是 Fulfilled (4)，则不应动态变为 Expired
        it("如果状态是 Fulfilled (4)，则不应变为 Expired (3)", async function () {
            // 铸造一个最大索赔次数为 1 的产品
            const fulfilledTokenId = await issueNewProductAndWarranty(1, 100); // 100 天保修
            
            // 客户发起并批准索赔 (状态变为 Fulfilled: 4)
            // 修复：使用完整函数签名 requestService(uint256,string)
            await warranty.connect(customer1)['requestService(uint256,string)'](fulfilledTokenId, "Fulfill Request");
            await warranty.connect(serviceCenter).approveClaim(fulfilledTokenId, "Claim Fulfilled");

            // 验证状态为 Fulfilled (4)
            let [, , , , statusBefore] = await warranty.getWarrantyStatus(fulfilledTokenId);
            expect(statusBefore).to.equal(ClaimStatus.Fulfilled);

            // 时间前进一年
            const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;
            await ethers.provider.send("evm_increaseTime", [ONE_YEAR_IN_SECONDS]);
            await ethers.provider.send("evm_mine"); 
            
            // 验证状态仍然为 Fulfilled (4)
            let [, , , , statusAfter] = await warranty.getWarrantyStatus(fulfilledTokenId);
            expect(statusAfter).to.equal(ClaimStatus.Fulfilled); 
            // 验证 isWarrantyValid 仍为 false
            expect(await warranty.isWarrantyValid(fulfilledTokenId)).to.be.false;
        });
    });
});