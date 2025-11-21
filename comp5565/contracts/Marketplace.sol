// File: Marketplace.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./I_Interfaces.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; 

contract Marketplace is Ownable { 
    
    IRolesContract public accessControl;
    IWarrantyManager public warrantyManager;
    IProductRegistry public productRegistry; 

    event ProductListed(uint256 indexed productId, uint256 price, address indexed seller);
    // [重要] 记录交易金额和买卖双方
    event ProductSold(uint256 indexed productId, address indexed buyer, address indexed seller, uint256 price);

    constructor(address _accessControl, address _warrantyManager) Ownable(msg.sender) { 
        require(_accessControl != address(0) && _warrantyManager != address(0), "Invalid address");
        accessControl = IRolesContract(_accessControl);
        warrantyManager = IWarrantyManager(_warrantyManager);
    }

    function setProductRegistryAddress(address _registryAddr) public onlyOwner { 
        require(address(productRegistry) == address(0), "MP: Registry already set.");
        require(_registryAddr != address(0), "MP: Invalid address.");
        productRegistry = IProductRegistry(_registryAddr);
    }

    // =========================================================
    // 1. 制造商注册并上架 (库存模式)
    // =========================================================
    function registerProduct(
        string memory serialNumber,
        string memory modelDetails,
        string memory manufacturerDetails,
        uint256 price,
        string memory warrantyTermsURI,
        uint256 durationDays,
        uint8 maxClaims
    ) external {
        // 权限检查：只有制造商
        require(accessControl.isManufacturer(msg.sender), "MP: Only Manufacturer can register.");
        require(address(productRegistry) != address(0), "MP: Registry not set."); 

        // 1. 铸造 NFT 给制造商自己 (状态自动设为 Listed)
        uint256 tokenId = productRegistry.mintProduct(
            msg.sender, 
            serialNumber,
            modelDetails,
            manufacturerDetails,
            price,
            warrantyTermsURI
        );

        // 2. 激活保修
        warrantyManager.issueWarranty(tokenId, durationDays, maxClaims);

        // 3. 发出上架事件
        emit ProductListed(tokenId, price, msg.sender);
    }

    // =========================================================
    // 2. 核心购买功能 (支持库存购买)
    // =========================================================
    // 前端调用此函数，并附带 ETH (msg.value)
    function buyProduct(uint256 productId) external payable {
        require(address(productRegistry) != address(0), "MP: Registry not set.");

        // A. 获取产品信息
        address seller = productRegistry.ownerOf(productId);
        (uint256 price, bool isListed) = productRegistry.getProductMarketInfo(productId);

        // B. 基础验证
        require(isListed, "MP: Product not listed for sale.");
        require(seller != address(0), "MP: Invalid seller.");
        require(msg.sender != seller, "MP: Cannot buy your own product.");
        require(msg.value >= price, "MP: Insufficient funds sent.");

        // C. 供应链角色流转限制
        if (accessControl.isManufacturer(seller)) {
            // 制造商的货，只能由零售商买
            require(accessControl.isRetailer(msg.sender), "MP: Only Retailers can buy from Manufacturer.");
        } 
        // 零售商的货，普通人都能买，无需额外限制

        // D. 资金转移 (给钱)
        (bool success, ) = payable(seller).call{value: price}("");
        require(success, "MP: Transfer of funds to seller failed.");

        // 如果付多了，退钱
        if (msg.value > price) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: msg.value - price}("");
            require(refundSuccess, "MP: Refund failed.");
        }

        // E. NFT 所有权转移 (交货)
        // 使用特权函数强制转移，无需 seller 手动 approve
        productRegistry.executeMarketTransaction(seller, msg.sender, productId);

        // F. 自动下架
        productRegistry.updateMarketInfo(productId, price, false);

        // G. 记录详细历史
        string memory eventType = "SECONDARY_SALE";
        if (accessControl.isManufacturer(seller)) {
            eventType = "DISTRIBUTION_SALE"; // 分销
        } else if (accessControl.isRetailer(seller)) {
            eventType = "RETAIL_SALE";       // 零售
        }
        productRegistry.recordOwnershipTransfer(productId, seller, msg.sender, eventType);

        emit ProductSold(productId, msg.sender, seller, price);
    }

    // =========================================================
    // 3. 再次上架/改价 (用于零售商售卖或客户转售)
    // =========================================================
    function listProduct(uint256 productId, uint256 price) external {
        require(address(productRegistry) != address(0), "MP: Registry not set.");
        
        // 只有当前拥有者可以操作
        require(productRegistry.ownerOf(productId) == msg.sender, "MP: Not owner.");
        require(price > 0, "MP: Price must be > 0");

        // 更新价格并上架
        productRegistry.updateMarketInfo(productId, price, true);
        emit ProductListed(productId, price, msg.sender);
    }

    // =========================================================
    // 4. 下架功能
    // =========================================================
    function delistProduct(uint256 productId) external {
        require(productRegistry.ownerOf(productId) == msg.sender, "MP: Not owner.");
        (uint256 currentPrice, ) = productRegistry.getProductMarketInfo(productId);
        productRegistry.updateMarketInfo(productId, currentPrice, false);
    }
}