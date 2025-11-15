/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ITerminalCommandService } from '../../../../services/ai/common/terminalCommandService.js';
import { TerminalCommandService } from '../../../../services/ai/node/terminalCommandServiceImpl.js';

registerSingleton(ITerminalCommandService, TerminalCommandService, InstantiationType.Delayed);

