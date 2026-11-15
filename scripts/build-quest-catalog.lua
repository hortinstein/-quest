-- Run with Lua 5.4: lua scripts/build-quest-catalog.lua /path/to/QuestieDB | gzip -n > site/data/quest-catalog.json.gz
local root = assert(arg[1], "Pass the path to a QuestieDB checkout")
local function read(path)
    local handle = assert(io.open(root .. "/" .. path))
    local text = handle:read("*a")
    handle:close()
    return text
end

local source = read("data/Forever/foreverQuestDB.lua")
local quests = assert(load(assert(source:match("questData = %[%[(.-)%]%]")), "quest data", "t", {}))()
local zones, parents, zoneIds = {}, {}, {}
for name, id in read("src/corrections/enum/zones.lua"):gmatch("([A-Z][A-Z_0-9]+)%s*=%s*(%d+)") do
    zoneIds[name] = tonumber(id)
    zones[tonumber(id)] = name:lower():gsub("_", " "):gsub("%f[%a]%a", string.upper)
end
local keys = {}
for line in source:match("questKeys = {(.-)\n}"):gmatch("[^\n]+") do
    local key, index = line:match("^    %['([%w]+)'%] = (%d+)")
    if key then keys[key] = tonumber(index) end
end
setmetatable(keys, { __index = function(_, key) return key end })
local models = {
    QuestieDB = {
        questKeys = keys,
        raceKeys = {
            HUMAN = 1, ORC = 2, DWARF = 4, NIGHT_ELF = 8, UNDEAD = 16, TAUREN = 32, GNOME = 64, TROLL = 128,
            SKYBORNE_ALLIANCE = 4294967296, SKYBORNE_HORDE = 8589934592,
            ALL_ALLIANCE = 4294967373, ALL_HORDE = 8589934770,
        },
        classKeys = { WARRIOR = 1, PALADIN = 2, HUNTER = 4, ROGUE = 8, PRIEST = 16,
            SHAMAN = 64, MAGE = 128, WARLOCK = 256, DRUID = 1024 },
        sortKeys = setmetatable({}, { __index = function() return -1 end }),
    },
    ZoneDB = { zoneIDs = zoneIds },
}
local loader = {}
function loader:ImportModule(name) return assert(models[name]) end
function loader:CreateModule() return {} end
local delta = read("src/corrections/Forever/generated/foreverBaseQuest.lua")
local patch = assert(load(delta, "Forever quest additions", "t", { QuestieLoader = loader }))():Load()
for id, fields in pairs(patch) do
    local quest = quests[id] or {}
    for key, value in pairs(fields) do
        if type(key) == "number" then quest[key] = value end
    end
    if quest[1] then quests[id] = quest end
end

local geographic = read("support/Forever/Zones/subZoneToParentZone.lua")
for child, parent, name in geographic:gmatch("%[(%d+)%] = (%d+), %-%- [^\n]- %-> ([^\n]+)") do
    child, parent = tonumber(child), tonumber(parent)
    if child ~= parent then parents[child] = parent end
    zones[parent] = name
end
local function zoneName(id)
    if not id or id <= 0 then return nil end
    local visited = {}
    while parents[id] and not visited[id] do
        visited[id] = true
        id = parents[id]
    end
    return zones[id]
end

local escapes = { ['"'] = '\\"', ['\\'] = '\\\\' }
local function stringJson(value)
    return '"' .. value:gsub('[%z\1-\31\\"]', function(c)
        return escapes[c] or string.format("\\u%04x", c:byte())
    end) .. '"'
end
local function ids(values)
    local output = {}
    for _, id in ipairs(values or {}) do
        if type(id) == "number" and id > 0 then output[#output + 1] = tostring(id) end
    end
    return "[" .. table.concat(output, ",") .. "]"
end

local order = {}
for id in pairs(quests) do order[#order + 1] = id end
table.sort(order)
local lines = {}
for _, id in ipairs(order) do
    local q = quests[id]
    local out = { '"id":' .. id, '"name":' .. stringJson(q[1]) }
    local function add(key, value)
        if value then out[#out + 1] = stringJson(key) .. ":" .. value end
    end
    local zone = zoneName(q[17])
    local objectives = table.concat(q[8] or {}, "\n")
    add("zone", zone and stringJson(zone))
    add("objectives", objectives ~= "" and stringJson(objectives))
    add("minLevel", q[4] or 0)
    add("level", q[5] or 0)
    add("maxLevel", q[32] and q[32] > 0 and q[32])
    add("raceMask", q[6] and q[6] ~= 0 and q[6])
    add("classMask", q[7] and q[7] ~= 0 and q[7])
    add("allOf", q[12] and ids(q[12]))
    add("anyOf", q[13] and ids(q[13]))
    add("next", q[22] and q[22] > 0 and q[22])
    add("parent", q[25] and q[25] > 0 and q[25])
    add("breadcrumb", q[27] and q[27] > 0 and q[27])
    add("exclusive", q[16] and ids(q[16]))
    if q[17] and q[17] < 0 or q[18] or q[19] or q[20] or q[25] or q[30]
        or q[31] or q[33] or q[34] or q[35] or q[36] or ((q[24] or 0) & 2) ~= 0 then
        add("restricted", "true")
    end
    lines[#lines + 1] = "{" .. table.concat(out, ",") .. "}"
end
io.write("[\n", table.concat(lines, ",\n"), "\n]\n")
