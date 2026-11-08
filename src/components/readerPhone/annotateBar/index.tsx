import { connect } from "react-redux";
import { withTranslation } from "react-i18next";
import {
  handleHighlight,
  handleFetchNotes,
  handleNoteKey,
  handleMenuMode,
  handleOpenMenu,
} from "../../../store/actions";
import { stateType } from "../../../store";
import AnnotateBar from "./component";

const mapStateToProps = (state: stateType) => ({
  highlight: state.reader.highlight,
  currentBook: state.book.currentBook,
  htmlBook: state.reader.htmlBook,
});
const actionCreator = {
  handleHighlight,
  handleFetchNotes,
  handleNoteKey,
  handleMenuMode,
  handleOpenMenu,
};
export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(AnnotateBar as any) as any);
