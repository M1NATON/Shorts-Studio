import React from "react";
import type { Block } from "@shorts/contracts";
import { assertNever } from "@shorts/contracts";
import { BarsBlock, NumberBlock, RingBlock } from "./DataBlocks.js";
import { ChipsBlock, IconBlock, PairBlock, RowBlock } from "./CardBlocks.js";
import { BadgeBlock, CaptionBlock, DividerBlock, HeadingBlock, QuoteBlock } from "./TextBlocks.js";

interface Timing {
  readonly localFrame: number;
  readonly remainingFrames: number;
  readonly align: "left" | "center";
}

/** Единственное место сопоставления блока и компонента; assertNever ловит забытые. */
export const BlockView: React.FC<{ block: Block } & Timing> = ({ block, ...timing }) => {
  switch (block.block) {
    case "heading":
      return <HeadingBlock block={block} {...timing} />;
    case "caption":
      return <CaptionBlock block={block} {...timing} />;
    case "number":
      return <NumberBlock block={block} {...timing} />;
    case "ring":
      return <RingBlock block={block} {...timing} />;
    case "bars":
      return <BarsBlock block={block} {...timing} />;
    case "row":
      return <RowBlock block={block} {...timing} />;
    case "chips":
      return <ChipsBlock block={block} {...timing} />;
    case "badge":
      return <BadgeBlock block={block} {...timing} />;
    case "icon":
      return <IconBlock block={block} {...timing} />;
    case "divider":
      return <DividerBlock block={block} {...timing} />;
    case "quote":
      return <QuoteBlock block={block} {...timing} />;
    case "pair":
      return <PairBlock block={block} {...timing} />;
    default:
      return assertNever(block);
  }
};
