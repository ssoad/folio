import { connect } from "react-redux";
import { withTranslation } from "react-i18next";
import DisplaySheet from "./component";
import { stateType } from "../../../store";
import {
  handleBackgroundColor,
  handleReaderMode,
} from "../../../store/actions";

const mapStateToProps = (state: stateType) => {
  return {
    currentBook: state.book.currentBook,
    readerMode: state.reader.readerMode,
    renderBookFunc: state.book.renderBookFunc,
  };
};
const actionCreator = { handleReaderMode, handleBackgroundColor };
export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(DisplaySheet as any) as any);
