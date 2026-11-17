-- Expand 阶段：只做向后兼容的变更。
-- 带默认值的新列不影响旧版本代码的 INSERT/SELECT，滚动发布期间新旧版本可以共存。
-- Contract 阶段（删除旧列、收紧约束）必须等所有旧版本下线后，用新的迁移文件完成。
ALTER TABLE orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY';
