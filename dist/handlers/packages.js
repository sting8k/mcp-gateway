export async function handleListToolPackages(input, registry, catalog) {
    const { safe_only = true, limit = 100, include_health = true } = input;
    const packages = registry.getPackages({ safe_only }).slice(0, limit);
    const packageInfos = await Promise.all(packages.map(async (pkg) => {
        const toolCount = catalog.countTools(pkg.id);
        const health = include_health ? await registry.healthCheck(pkg.id) : undefined;
        const summary = await catalog.buildPackageSummary(pkg);
        const authMode = pkg.transport === "http"
            ? (pkg.auth?.mode ?? "none")
            : "env";
        return {
            package_id: pkg.id,
            name: pkg.name,
            description: pkg.description,
            transport: pkg.transport,
            auth_mode: authMode,
            tool_count: toolCount,
            health,
            summary: pkg.description || summary,
            visibility: pkg.visibility,
        };
    }));
    const result = {
        packages: packageInfos,
        catalog_etag: catalog.etag(),
        updated_at: new Date().toISOString(),
    };
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(result, null, 2),
            },
        ],
        isError: false,
    };
}
